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

func TestADOPROpen_Execute(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{
		Organization: "acme", BaseURL: "https://dev.azure.com", AuthMode: "basic-pat", Token: "pat-123",
	}}
	client := &fakeADORepoClient{prResult: &services.ADOPullRequestResult{PRID: "42", PRURL: "https://dev.azure.com/acme/proj/_git/orders/pullrequest/42"}}
	a := NewADOPROpen(conn, adoFactory(client))

	raw, err := a.Execute(context.Background(), runCtxWithWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","repoId":"repo-1","sourceBranch":"feature/x","targetBranch":"main","title":"Add x","description":"d"}`))
	require.NoError(t, err)

	var out adoPROpenOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "42", out.PRID)
	assert.Contains(t, out.PRURL, "pullrequest/42")
	assert.Equal(t, []string{"ws-1"}, conn.wsIDs, "workspace id must be forwarded to the connection lookup")
	assert.Equal(t, "acme", client.gotOrg)
	assert.Equal(t, "repo-1", client.gotRepoID)
	assert.Equal(t, "feature/x", client.gotSource)
	assert.Equal(t, "main", client.gotTarget)
	assert.Equal(t, "Add x", client.gotTitle)
}

func TestADOPROpen_MissingFields(t *testing.T) {
	a := NewADOPROpen(&fakeADOConnectionClient{}, adoFactory(&fakeADORepoClient{}))
	for _, input := range []string{
		`{"project":"proj","repoId":"r","sourceBranch":"a","targetBranch":"b","title":"t"}`,
		`{"connection":"c","repoId":"r","sourceBranch":"a","targetBranch":"b","title":"t"}`,
		`{"connection":"c","project":"proj","sourceBranch":"a","targetBranch":"b","title":"t"}`,
		`{"connection":"c","project":"proj","repoId":"r","targetBranch":"b","title":"t"}`,
		`{"connection":"c","project":"proj","repoId":"r","sourceBranch":"a","title":"t"}`,
		`{"connection":"c","project":"proj","repoId":"r","sourceBranch":"a","targetBranch":"b"}`,
	} {
		_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(input))
		require.Error(t, err, input)
		assert.ErrorIs(t, err, scaffolder.ErrInvalidInput, input)
	}
}

func TestADOPROpen_ClientError_NotFoundIsInvalidInput(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	client := &fakeADORepoClient{prErr: fmt.Errorf("%w: azure devops HTTP 404", services.ErrADOInvalidInput)}
	a := NewADOPROpen(conn, adoFactory(client))
	_, err := a.Execute(context.Background(), runCtxWithWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","repoId":"repo-1","sourceBranch":"a","targetBranch":"b","title":"t"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
}

func TestADOPROpen_EmptyWorkspaceID_IsInvalidInput(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	a := NewADOPROpen(conn, adoFactory(&fakeADORepoClient{}))
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"connection":"c","project":"proj","repoId":"repo-1","sourceBranch":"a","targetBranch":"b","title":"t"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
	assert.Empty(t, conn.calls)
}

func TestADOPROpen_Plan_NoHTTP(t *testing.T) {
	client := &fakeADORepoClient{}
	a := NewADOPROpen(&fakeADOConnectionClient{}, adoFactory(client))
	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(`{"connection":"c","project":"proj","repoId":"repo-1","sourceBranch":"a","targetBranch":"b","title":"Add x"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "pr", changes[0].Kind)
	assert.Empty(t, client.gotOrg)
}

func TestADOPROpen_SchemasAndRegistration(t *testing.T) {
	a := NewADOPROpen(nil, nil)
	assert.Equal(t, "ado:pr:open", a.Name())
	var probe map[string]any
	require.NoError(t, json.Unmarshal(a.InputSchema(), &probe))
	require.NoError(t, json.Unmarshal(a.OutputSchema(), &probe))

	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("ado:pr:open")
	require.True(t, ok)
	assert.Equal(t, "ado", d.Family)
	assert.True(t, d.SupportsPlan)
}
