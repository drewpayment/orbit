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

type fakeADOConnectionClient struct {
	conn  services.ADOConnectionToken
	err   error
	calls []string // connectionID
	wsIDs []string // workspaceID, parallel to calls
}

func (f *fakeADOConnectionClient) GetConnectionToken(_ context.Context, connectionID, workspaceID string) (services.ADOConnectionToken, error) {
	f.calls = append(f.calls, connectionID)
	f.wsIDs = append(f.wsIDs, workspaceID)
	return f.conn, f.err
}

// runCtxWithADOWorkspace is the ADO actions' variant of runCtx: every ado:*
// action requires rc.WorkspaceID to scope its connection lookup (see
// resolveADOConnection), so Execute-path tests use this instead of the
// bare runCtx(). (Named distinctly from fetch_orbit_skeleton_test.go's own
// runCtxWithWorkspace(t, dir, workspaceID) helper, whose signature differs.)
func runCtxWithADOWorkspace(workspaceID string) scaffolder.ActionRunContext {
	return scaffolder.NewActionRunContext(scaffolder.ActionRunContext{RunID: "run-1", WorkspaceID: workspaceID})
}

type fakeADORepoClient struct {
	repoResult *services.ADORepoResult
	repoErr    error
	prResult   *services.ADOPullRequestResult
	prErr      error
	pipeResult *services.ADOPipelineResult
	pipeErr    error

	lastBaseURL, lastAuthHeader string

	gotOrg, gotProject, gotName string
	gotRepoID                   string
	gotSource, gotTarget        string
	gotTitle, gotDescription    string
	gotYAMLPath                 string
}

func (f *fakeADORepoClient) CreateRepository(_ context.Context, org, project, name string) (*services.ADORepoResult, error) {
	f.gotOrg, f.gotProject, f.gotName = org, project, name
	if f.repoErr != nil {
		return nil, f.repoErr
	}
	return f.repoResult, nil
}

func (f *fakeADORepoClient) CreatePullRequest(_ context.Context, org, project, repoID, sourceBranch, targetBranch, title, description string) (*services.ADOPullRequestResult, error) {
	f.gotOrg, f.gotProject, f.gotRepoID = org, project, repoID
	f.gotSource, f.gotTarget, f.gotTitle, f.gotDescription = sourceBranch, targetBranch, title, description
	if f.prErr != nil {
		return nil, f.prErr
	}
	return f.prResult, nil
}

func (f *fakeADORepoClient) CreatePipeline(_ context.Context, org, project, name, repoID, yamlPath string) (*services.ADOPipelineResult, error) {
	f.gotOrg, f.gotProject, f.gotName, f.gotRepoID, f.gotYAMLPath = org, project, name, repoID, yamlPath
	if f.pipeErr != nil {
		return nil, f.pipeErr
	}
	return f.pipeResult, nil
}

func adoFactory(client *fakeADORepoClient) ADOClientFactory {
	return func(baseURL, authHeader string) ADORepoClient {
		client.lastBaseURL, client.lastAuthHeader = baseURL, authHeader
		return client
	}
}

func TestADORepoCreate_Execute(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{
		Organization: "acme", BaseURL: "https://dev.azure.com", AuthMode: "basic-pat", Token: "pat-123",
	}}
	client := &fakeADORepoClient{repoResult: &services.ADORepoResult{
		RepoID: "repo-1", RepoURL: "https://dev.azure.com/acme/proj/_git/orders",
		CloneURL: "https://dev.azure.com/acme/proj/_git/orders", Project: "proj",
	}}
	a := NewADORepoCreate(conn, adoFactory(client))

	raw, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"conn-1","project":"proj","name":"orders"}`))
	require.NoError(t, err)

	var out adoRepoCreateOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "repo-1", out.RepoID)
	assert.Equal(t, "https://dev.azure.com/acme/proj/_git/orders", out.RepoURL)
	assert.Equal(t, "proj", out.Project)
	assert.Equal(t, []string{"conn-1"}, conn.calls)
	assert.Equal(t, []string{"ws-1"}, conn.wsIDs, "workspace id must be forwarded to the connection lookup")
	assert.Equal(t, "acme", client.gotOrg)
	assert.Equal(t, "proj", client.gotProject)
	assert.Equal(t, "orders", client.gotName)
	assert.Equal(t, services.BuildADOAuthHeader("basic-pat", "pat-123"), client.lastAuthHeader)
	assert.Equal(t, "https://dev.azure.com", client.lastBaseURL)
}

func TestADORepoCreate_MissingFields(t *testing.T) {
	a := NewADORepoCreate(&fakeADOConnectionClient{}, adoFactory(&fakeADORepoClient{}))
	for _, input := range []string{
		`{"project":"proj","name":"orders"}`,
		`{"connection":"c","name":"orders"}`,
		`{"connection":"c","project":"proj"}`,
	} {
		_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(input))
		require.Error(t, err, input)
		assert.ErrorIs(t, err, scaffolder.ErrInvalidInput, input)
	}
}

func TestADORepoCreate_ConnectionNotFound_IsInvalidInput(t *testing.T) {
	conn := &fakeADOConnectionClient{err: services.ErrConnectionNotFound}
	a := NewADORepoCreate(conn, adoFactory(&fakeADORepoClient{}))
	_, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"missing","project":"proj","name":"orders"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
}

func TestADORepoCreate_NetworkError_IsRetryable(t *testing.T) {
	conn := &fakeADOConnectionClient{err: fmt.Errorf("dial tcp: timeout")}
	a := NewADORepoCreate(conn, adoFactory(&fakeADORepoClient{}))
	_, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","name":"orders"}`))
	require.Error(t, err)
	assert.NotErrorIs(t, err, scaffolder.ErrInvalidInput)
}

func TestADORepoCreate_ClientError_WrapsInvalidInput(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	client := &fakeADORepoClient{repoErr: fmt.Errorf("%w: azure devops HTTP 404", services.ErrADOInvalidInput)}
	a := NewADORepoCreate(conn, adoFactory(client))
	_, err := a.Execute(context.Background(), runCtxWithADOWorkspace("ws-1"), json.RawMessage(`{"connection":"c","project":"proj","name":"orders"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
}

// TestADORepoCreate_EmptyWorkspaceID_IsInvalidInput is the direct regression
// test for the workspace-scoping fix: a run whose ActionRunContext carries
// no workspace must fail closed rather than resolving the connection
// unscoped (which would let a bare connection id from any workspace be used
// by any run).
func TestADORepoCreate_EmptyWorkspaceID_IsInvalidInput(t *testing.T) {
	conn := &fakeADOConnectionClient{conn: services.ADOConnectionToken{Organization: "acme", BaseURL: "u", AuthMode: "basic-pat", Token: "t"}}
	a := NewADORepoCreate(conn, adoFactory(&fakeADORepoClient{}))
	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"connection":"c","project":"proj","name":"orders"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, scaffolder.ErrInvalidInput)
	// Must fail before ever calling the connection client.
	assert.Empty(t, conn.calls)
}

func TestADORepoCreate_Plan_NoHTTP(t *testing.T) {
	client := &fakeADORepoClient{}
	a := NewADORepoCreate(&fakeADOConnectionClient{}, adoFactory(client))
	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(`{"connection":"c","project":"proj","name":"orders"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "repo", changes[0].Kind)
	assert.Equal(t, "orders", changes[0].Name)
	// Plan must never touch the network: no client call recorded any input.
	assert.Empty(t, client.gotOrg)
}

func TestADORepoCreate_SchemasAndRegistration(t *testing.T) {
	a := NewADORepoCreate(nil, nil)
	assert.Equal(t, "ado:repo:create", a.Name())
	var probe map[string]any
	require.NoError(t, json.Unmarshal(a.InputSchema(), &probe))
	require.NoError(t, json.Unmarshal(a.OutputSchema(), &probe))

	r := scaffolder.NewRegistry(a)
	require.NoError(t, r.ValidateSchemas())
	d, ok := r.Descriptor("ado:repo:create")
	require.True(t, ok)
	assert.Equal(t, "ado", d.Family)
	assert.True(t, d.SupportsPlan)
}
