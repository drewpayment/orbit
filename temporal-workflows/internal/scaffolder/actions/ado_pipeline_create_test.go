package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestADOPipelineCreate_Execute(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{
		Organization: "acme", BaseURL: "https://dev.azure.com", AuthMode: "basic-pat", Token: "pat-123",
	}}
	client := &fakeADORepoClient{pipeResult: &services.ADOPipelineResult{PipelineID: "7", PipelineURL: "https://dev.azure.com/acme/proj/_build?definitionId=7"}}
	a := NewADOPipelineCreate(conn, adoFactory(client))

	raw, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","name":"orders-ci","repoId":"repo-1"}`))
	require.NoError(t, err)

	var out adoPipelineCreateOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "7", out.PipelineID)
	assert.Contains(t, out.PipelineURL, "definitionId=7")
	assert.Equal(t, []string{"ws-1"}, conn.wsIDs, "workspace id must be forwarded to the connection lookup")
	assert.Equal(t, "acme", client.gotOrg)
	assert.Equal(t, "orders-ci", client.gotName)
	assert.Equal(t, "repo-1", client.gotRepoID)
	// Default yamlPath applied when omitted.
	assert.Equal(t, "azure-pipelines.yml", client.gotYAMLPath)
}

func TestADOPipelineCreate_CustomYAMLPath(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	client := &fakeADORepoClient{pipeResult: &services.ADOPipelineResult{PipelineID: "1", PipelineURL: "u"}}
	a := NewADOPipelineCreate(conn, adoFactory(client))
	_, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","name":"n","repoId":"r","yamlPath":"ci/pipeline.yml"}`))
	require.NoError(t, err)
	assert.Equal(t, "ci/pipeline.yml", client.gotYAMLPath)
}

func TestADOPipelineCreate_MissingFields(t *testing.T) {
	a := NewADOPipelineCreate(&fakeADOConnectionClient{}, adoFactory(&fakeADORepoClient{}))
	for _, input := range []string{
		`{"project":"proj","name":"n","repoId":"r"}`,
		`{"connection":"c","name":"n","repoId":"r"}`,
		`{"connection":"c","project":"proj","repoId":"r"}`,
		`{"connection":"c","project":"proj","name":"n"}`,
	} {
		_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(input))
		require.Error(t, err, input)
		assert.ErrorIs(t, err, scaffolder.ErrInvalidInput, input)
	}
}

// TestADOPipelineCreate_MissingYAMLFile_SurfacesADOError covers the bounded
// first-cut scope: this action never generates YAML content, so a missing
// file in the repo is expected to surface as whatever error Azure DevOps'
// own API returns (modeled here as a 404 from the fake client), not a
// special-cased friendly message.
func TestADOPipelineCreate_MissingYAMLFile_SurfacesADOError(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	client := &fakeADORepoClient{pipeErr: fmt.Errorf("%w: azure devops HTTP 404", services.ErrADOInvalidInput)}
	a := NewADOPipelineCreate(conn, adoFactory(client))
	_, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","name":"n","repoId":"r","yamlPath":"missing.yml"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
	assert.Contains(t, err.Error(), "404")
}

func TestADOPipelineCreate_EmptyWorkspaceID_IsInvalidInput(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	a := NewADOPipelineCreate(conn, adoFactory(&fakeADORepoClient{}))
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"connection":"c","project":"proj","name":"n","repoId":"r"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
	assert.Empty(t, conn.calls)
}

func TestADOPipelineCreate_Plan_NoHTTP(t *testing.T) {
	client := &fakeADORepoClient{}
	a := NewADOPipelineCreate(&fakeADOConnectionClient{}, adoFactory(client))
	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(`{"connection":"c","project":"proj","name":"orders-ci","repoId":"repo-1"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "pipeline", changes[0].Kind)
	assert.Empty(t, client.gotOrg)
}

func TestADOPipelineCreate_SchemasAndRegistration(t *testing.T) {
	a := NewADOPipelineCreate(nil, nil)
	assert.Equal(t, "ado:pipeline:create", a.Name())
	var probe map[string]any
	require.NoError(t, json.Unmarshal(a.InputSchema(), &probe))
	require.NoError(t, json.Unmarshal(a.OutputSchema(), &probe))

	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("ado:pipeline:create")
	require.True(t, ok)
	assert.Equal(t, "ado", d.Family)
	assert.True(t, d.SupportsPlan)
}
