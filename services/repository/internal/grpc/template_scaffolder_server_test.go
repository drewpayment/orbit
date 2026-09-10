package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// --- mocks ------------------------------------------------------------------

// MockScaffolderTemporalClient extends the v1 mock with the v2 entry points.
type MockScaffolderTemporalClient struct {
	MockTemporalClient
}

func (m *MockScaffolderTemporalClient) StartScaffolderWorkflow(ctx context.Context, in types.ScaffolderWorkflowInput) (string, error) {
	args := m.Called(ctx, in)
	return args.String(0), args.Error(1)
}

func (m *MockScaffolderTemporalClient) ScaffolderRunWorkspace(ctx context.Context, workflowID string) (string, error) {
	args := m.Called(ctx, workflowID)
	return args.String(0), args.Error(1)
}

func (m *MockScaffolderTemporalClient) QueryScaffolderProgress(ctx context.Context, workflowID string) (*types.ScaffolderProgress, error) {
	args := m.Called(ctx, workflowID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*types.ScaffolderProgress), args.Error(1)
}

type MockDefinitionClient struct {
	mock.Mock
}

func (m *MockDefinitionClient) GetDefinitionVersion(ctx context.Context, versionID string) (*TemplateDefinitionVersionData, error) {
	args := m.Called(ctx, versionID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*TemplateDefinitionVersionData), args.Error(1)
}

const testDefinitionJSON = `{"apiVersion":"orbit/v2","kind":"Template","metadata":{"name":"svc","title":"Service","owner":"platform"},"spec":{"parameters":[],"steps":[]}}`

func testVersion() *TemplateDefinitionVersionData {
	return &TemplateDefinitionVersionData{
		ID:             "ver-1",
		DefinitionID:   "def-1",
		WorkspaceID:    "ws-1",
		VersionNumber:  2,
		DefinitionJSON: json.RawMessage(testDefinitionJSON),
	}
}

func validScaffolderRequest() *templatev1.StartScaffolderRunRequest {
	params, _ := structpb.NewStruct(map[string]any{"name": "orders", "private": true, "count": float64(2)})
	return &templatev1.StartScaffolderRunRequest{
		RunId:               "run-1",
		DefinitionVersionId: "ver-1",
		WorkspaceId:         "ws-1",
		UserId:              "user-1",
		Parameters:          params,
		DryRun:              true,
	}
}

// authCtx carries a verified identity for workspace ws-1, the way the
// service-auth interceptor would in production. EnforceWorkspace rejects a
// request with no identity, so every StartScaffolderRun test needs one.
func authCtx() context.Context {
	return svcauth.WithIdentity(context.Background(), svcauth.Identity{
		UserID:      "user-1",
		WorkspaceID: "ws-1",
	})
}

func connectCode(t *testing.T, err error) connect.Code {
	t.Helper()
	var cErr *connect.Error
	require.True(t, errors.As(err, &cErr), "expected a connect error, got %T: %v", err, err)
	return cErr.Code()
}

// --- StartScaffolderRun -----------------------------------------------------

func TestStartScaffolderRun_Success(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	defMock := new(MockDefinitionClient)
	defMock.On("GetDefinitionVersion", mock.Anything, "ver-1").Return(testVersion(), nil)

	var got types.ScaffolderWorkflowInput
	temporalMock.On("StartScaffolderWorkflow", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { got = args.Get(1).(types.ScaffolderWorkflowInput) }).
		Return("scaffolder-run-1", nil)

	server := NewTemplateServer(temporalMock, nil, WithTemplateDefinitionClient(defMock))
	resp, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(validScaffolderRequest()))

	require.NoError(t, err)
	assert.Equal(t, "scaffolder-run-1", resp.Msg.WorkflowId)

	assert.Equal(t, "run-1", got.RunID)
	assert.Equal(t, "ver-1", got.DefinitionVersionID)
	assert.Equal(t, "ws-1", got.WorkspaceID)
	assert.Equal(t, "user-1", got.UserID)
	assert.True(t, got.DryRun)
	assert.JSONEq(t, testDefinitionJSON, string(got.Definition))
	// Struct carries typed, nested values; a map<string,string> could not.
	assert.Equal(t, "orders", got.Parameters["name"])
	assert.Equal(t, true, got.Parameters["private"])
	assert.Equal(t, float64(2), got.Parameters["count"])

	temporalMock.AssertExpectations(t)
	defMock.AssertExpectations(t)
}

func TestStartScaffolderRun_ValidatesRequiredFields(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(r *templatev1.StartScaffolderRunRequest)
	}{
		{name: "run id", mutate: func(r *templatev1.StartScaffolderRunRequest) { r.RunId = "" }},
		{name: "definition version id", mutate: func(r *templatev1.StartScaffolderRunRequest) { r.DefinitionVersionId = "" }},
		{name: "workspace id", mutate: func(r *templatev1.StartScaffolderRunRequest) { r.WorkspaceId = "" }},
	}
	for _, tt := range tests {
		t.Run(tt.name+" is required", func(t *testing.T) {
			temporalMock := new(MockScaffolderTemporalClient)
			defMock := new(MockDefinitionClient)
			req := validScaffolderRequest()
			tt.mutate(req)

			server := NewTemplateServer(temporalMock, nil, WithTemplateDefinitionClient(defMock))
			_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(req))

			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connectCode(t, err))
			// Neither collaborator may be touched on a rejected request.
			temporalMock.AssertNotCalled(t, "StartScaffolderWorkflow", mock.Anything, mock.Anything)
			defMock.AssertNotCalled(t, "GetDefinitionVersion", mock.Anything, mock.Anything)
		})
	}
}

func TestStartScaffolderRun_UnknownVersionIsNotFound(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	defMock := new(MockDefinitionClient)
	defMock.On("GetDefinitionVersion", mock.Anything, "ver-1").
		Return(nil, ErrTemplateDefinitionVersionNotFound)

	server := NewTemplateServer(temporalMock, nil, WithTemplateDefinitionClient(defMock))
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(validScaffolderRequest()))

	require.Error(t, err)
	assert.Equal(t, connect.CodeNotFound, connectCode(t, err))
	temporalMock.AssertNotCalled(t, "StartScaffolderWorkflow", mock.Anything, mock.Anything)
}

func TestStartScaffolderRun_VersionFetchFailureIsInternal(t *testing.T) {
	defMock := new(MockDefinitionClient)
	defMock.On("GetDefinitionVersion", mock.Anything, "ver-1").Return(nil, errors.New("payload down"))

	server := NewTemplateServer(new(MockScaffolderTemporalClient), nil, WithTemplateDefinitionClient(defMock))
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(validScaffolderRequest()))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connectCode(t, err))
}

func TestStartScaffolderRun_VersionOutsideRequestedWorkspaceIsDenied(t *testing.T) {
	defMock := new(MockDefinitionClient)
	other := testVersion()
	other.WorkspaceID = "ws-other"
	defMock.On("GetDefinitionVersion", mock.Anything, "ver-1").Return(other, nil)

	temporalMock := new(MockScaffolderTemporalClient)
	server := NewTemplateServer(temporalMock, nil, WithTemplateDefinitionClient(defMock))
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(validScaffolderRequest()))

	require.Error(t, err)
	assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err))
	temporalMock.AssertNotCalled(t, "StartScaffolderWorkflow", mock.Anything, mock.Anything)
}

func TestStartScaffolderRun_WithoutDefinitionClientIsFailedPrecondition(t *testing.T) {
	server := NewTemplateServer(new(MockScaffolderTemporalClient), nil)
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(validScaffolderRequest()))

	require.Error(t, err)
	assert.Equal(t, connect.CodeFailedPrecondition, connectCode(t, err))
}

func TestStartScaffolderRun_WithoutTemporalIsUnavailable(t *testing.T) {
	defMock := new(MockDefinitionClient)
	server := NewTemplateServer(nil, nil, WithTemplateDefinitionClient(defMock))
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(validScaffolderRequest()))

	require.Error(t, err)
	assert.Equal(t, connect.CodeUnavailable, connectCode(t, err))
}

func TestStartScaffolderRun_AcceptsNilParameters(t *testing.T) {
	defMock := new(MockDefinitionClient)
	defMock.On("GetDefinitionVersion", mock.Anything, "ver-1").Return(testVersion(), nil)

	var got types.ScaffolderWorkflowInput
	temporalMock := new(MockScaffolderTemporalClient)
	temporalMock.On("StartScaffolderWorkflow", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { got = args.Get(1).(types.ScaffolderWorkflowInput) }).
		Return("scaffolder-run-1", nil)

	req := validScaffolderRequest()
	req.Parameters = nil

	server := NewTemplateServer(temporalMock, nil, WithTemplateDefinitionClient(defMock))
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(req))

	require.NoError(t, err)
	assert.NotNil(t, got.Parameters, "a template with no parameters must still run")
	assert.Empty(t, got.Parameters)
}

// --- GetRunProgress ---------------------------------------------------------

func TestGetRunProgress_MapsTheQuerySnapshot(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	temporalMock.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-1", nil)
	temporalMock.On("QueryScaffolderProgress", mock.Anything, "scaffolder-run-1").Return(&types.ScaffolderProgress{
		Status: "succeeded",
		Steps: []types.ScaffolderStepProgress{
			{ID: "create", Name: "Create repo", Status: "succeeded"},
			{ID: "log", Name: "Log", Status: "failed", Error: "boom"},
		},
		Outputs: map[string]any{"text": "done", "count": float64(3)},
	}, nil)

	server := NewTemplateServer(temporalMock, nil)
	resp, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))

	require.NoError(t, err)
	assert.Equal(t, "scaffolder-run-1", resp.Msg.WorkflowId)
	assert.Equal(t, templatev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, resp.Msg.Status)
	require.Len(t, resp.Msg.Steps, 2)
	assert.Equal(t, "create", resp.Msg.Steps[0].Id)
	assert.Equal(t, "Create repo", resp.Msg.Steps[0].Name)
	assert.Equal(t, "failed", resp.Msg.Steps[1].Status)
	assert.Equal(t, "boom", resp.Msg.Steps[1].Error)
	require.NotNil(t, resp.Msg.Outputs)
	assert.Equal(t, "done", resp.Msg.Outputs.AsMap()["text"])
}

func TestGetRunProgress_MapsStatusStrings(t *testing.T) {
	tests := []struct {
		in   string
		want templatev1.WorkflowStatus
	}{
		{"running", templatev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING},
		{"succeeded", templatev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED},
		{"completed", templatev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED},
		{"failed", templatev1.WorkflowStatus_WORKFLOW_STATUS_FAILED},
		{"cancelled", templatev1.WorkflowStatus_WORKFLOW_STATUS_CANCELLED},
		{"pending", templatev1.WorkflowStatus_WORKFLOW_STATUS_PENDING},
		{"nonsense", templatev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			temporalMock := new(MockScaffolderTemporalClient)
			temporalMock.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-1", nil)
			temporalMock.On("QueryScaffolderProgress", mock.Anything, "scaffolder-run-1").
				Return(&types.ScaffolderProgress{Status: tt.in}, nil)

			server := NewTemplateServer(temporalMock, nil)
			resp, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))
			require.NoError(t, err)
			assert.Equal(t, tt.want, resp.Msg.Status)
		})
	}
}

func TestGetRunProgress_ReportsTheRunError(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	temporalMock.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-1", nil)
	temporalMock.On("QueryScaffolderProgress", mock.Anything, "scaffolder-run-1").
		Return(&types.ScaffolderProgress{Status: "failed", Error: "step create failed"}, nil)

	server := NewTemplateServer(temporalMock, nil)
	resp, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))
	require.NoError(t, err)
	assert.Equal(t, "step create failed", resp.Msg.ErrorMessage)
}

func TestGetRunProgress_RequiresWorkflowID(t *testing.T) {
	server := NewTemplateServer(new(MockScaffolderTemporalClient), nil)
	_, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connectCode(t, err))
}

func TestGetRunProgress_WithoutTemporalIsUnavailable(t *testing.T) {
	server := NewTemplateServer(nil, nil)
	_, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeUnavailable, connectCode(t, err))
}

// --- CancelRun --------------------------------------------------------------

func TestCancelRun_Success(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	temporalMock.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-1", nil)
	temporalMock.On("CancelWorkflow", mock.Anything, "scaffolder-run-1").Return(nil)

	server := NewTemplateServer(temporalMock, nil)
	resp, err := server.CancelRun(authCtx(), connect.NewRequest(&templatev1.CancelRunRequest{WorkflowId: "scaffolder-run-1"}))

	require.NoError(t, err)
	assert.True(t, resp.Msg.Success)
	temporalMock.AssertExpectations(t)
}

func TestCancelRun_RequiresWorkflowID(t *testing.T) {
	server := NewTemplateServer(new(MockScaffolderTemporalClient), nil)
	_, err := server.CancelRun(authCtx(), connect.NewRequest(&templatev1.CancelRunRequest{}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connectCode(t, err))
}

func TestCancelRun_PropagatesFailure(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	temporalMock.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-1", nil)
	temporalMock.On("CancelWorkflow", mock.Anything, "scaffolder-run-1").Return(errors.New("no such workflow"))

	server := NewTemplateServer(temporalMock, nil)
	_, err := server.CancelRun(authCtx(), connect.NewRequest(&templatev1.CancelRunRequest{WorkflowId: "scaffolder-run-1"}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connectCode(t, err))
}

// --- ListActions ------------------------------------------------------------

func TestListActions_ServesTheEmbeddedRegistry(t *testing.T) {
	server := NewTemplateServer(nil, nil)
	resp, err := server.ListActions(context.Background(), connect.NewRequest(&templatev1.ListActionsRequest{}))
	require.NoError(t, err)

	byName := map[string]*templatev1.ActionDescriptor{}
	for _, a := range resp.Msg.Actions {
		byName[a.Name] = a
	}

	// The engine's own actions must all be advertised, or the authoring UI
	// validates against a registry the worker does not have.
	for _, want := range []string{
		"debug:log", "http:request", "fs:render", "fetch:git", "git:push",
		"github:repo:create", "github:repo:create-from-template", "catalog:entity:register",
	} {
		require.Contains(t, byName, want)
	}

	fsRender := byName["fs:render"]
	assert.Equal(t, "fs", fsRender.Family)
	assert.True(t, fsRender.SupportsPlan)
	assert.True(t, json.Valid([]byte(fsRender.InputSchemaJson)), "input schema must be valid JSON")
	assert.True(t, json.Valid([]byte(fsRender.OutputSchemaJson)), "output schema must be valid JSON")

	assert.False(t, byName["http:request"].SupportsPlan,
		"http:request cannot be dry-run and must say so")
}

func TestListActions_IsSortedAndStable(t *testing.T) {
	server := NewTemplateServer(nil, nil)
	first, err := server.ListActions(context.Background(), connect.NewRequest(&templatev1.ListActionsRequest{}))
	require.NoError(t, err)
	second, err := server.ListActions(context.Background(), connect.NewRequest(&templatev1.ListActionsRequest{}))
	require.NoError(t, err)

	var names []string
	for _, a := range first.Msg.Actions {
		names = append(names, a.Name)
	}
	require.NotEmpty(t, names)
	assert.IsIncreasing(t, names)

	for i := range first.Msg.Actions {
		assert.Equal(t, first.Msg.Actions[i].Name, second.Msg.Actions[i].Name)
	}
}

// --- tenant isolation -------------------------------------------------------

func TestStartScaffolderRun_RejectsAnotherWorkspace(t *testing.T) {
	temporalMock := new(MockScaffolderTemporalClient)
	defMock := new(MockDefinitionClient)

	// A caller authorized for ws-1 asking to run in ws-2. Both the workspace
	// id and the version id are request-supplied, so only the identity check
	// can catch this.
	req := validScaffolderRequest()
	req.WorkspaceId = "ws-2"

	server := NewTemplateServer(temporalMock, nil, WithTemplateDefinitionClient(defMock))
	_, err := server.StartScaffolderRun(authCtx(), connect.NewRequest(req))

	require.Error(t, err)
	assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err))
	defMock.AssertNotCalled(t, "GetDefinitionVersion", mock.Anything, mock.Anything)
	temporalMock.AssertNotCalled(t, "StartScaffolderWorkflow", mock.Anything, mock.Anything)
}

func TestStartScaffolderRun_RejectsAnUnauthenticatedCaller(t *testing.T) {
	defMock := new(MockDefinitionClient)
	server := NewTemplateServer(new(MockScaffolderTemporalClient), nil, WithTemplateDefinitionClient(defMock))

	// No identity in the context: the interceptor did not run, or the token
	// carried no workspace. Fail closed.
	_, err := server.StartScaffolderRun(context.Background(), connect.NewRequest(validScaffolderRequest()))

	require.Error(t, err)
	assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err))
	defMock.AssertNotCalled(t, "GetDefinitionVersion", mock.Anything, mock.Anything)
}

// --- run-scoped authorization (Q3) ------------------------------------------

func TestScaffolderRunHandlers_RejectAnotherWorkspacesRun(t *testing.T) {
	// The run belongs to ws-2; the caller is authorized only for ws-1.
	newServer := func(t *testing.T) (*TemplateServer, *MockScaffolderTemporalClient) {
		t.Helper()
		m := new(MockScaffolderTemporalClient)
		m.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-2", nil)
		return NewTemplateServer(m, nil), m
	}

	t.Run("GetRunProgress", func(t *testing.T) {
		server, m := newServer(t)
		_, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))
		require.Error(t, err)
		assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err))
		m.AssertNotCalled(t, "QueryScaffolderProgress", mock.Anything, mock.Anything)
	})

	t.Run("CancelRun", func(t *testing.T) {
		server, m := newServer(t)
		_, err := server.CancelRun(authCtx(), connect.NewRequest(&templatev1.CancelRunRequest{WorkflowId: "scaffolder-run-1"}))
		require.Error(t, err)
		assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err))
		m.AssertNotCalled(t, "CancelWorkflow", mock.Anything, mock.Anything)
	})
}

func TestScaffolderRunHandlers_RejectARunWithNoWorkspaceMemo(t *testing.T) {
	m := new(MockScaffolderTemporalClient)
	m.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("", nil)

	server := NewTemplateServer(m, nil)
	_, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))

	require.Error(t, err)
	assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err),
		"an unscoped run must fail closed, not be served to anyone")
	m.AssertNotCalled(t, "QueryScaffolderProgress", mock.Anything, mock.Anything)
}

func TestScaffolderRunHandlers_RejectANonScaffolderWorkflowID(t *testing.T) {
	// These handlers must not become a generic query/cancel surface over every
	// workflow in the namespace.
	for _, id := range []string{"template-instantiation-foo-123", "agent-run-9", "wf-1"} {
		t.Run(id, func(t *testing.T) {
			m := new(MockScaffolderTemporalClient)
			server := NewTemplateServer(m, nil)

			_, err := server.CancelRun(authCtx(), connect.NewRequest(&templatev1.CancelRunRequest{WorkflowId: id}))
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connectCode(t, err))

			_, err = server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: id}))
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connectCode(t, err))

			m.AssertNotCalled(t, "ScaffolderRunWorkspace", mock.Anything, mock.Anything)
		})
	}
}

func TestScaffolderRunHandlers_UnknownRunIsNotFound(t *testing.T) {
	m := new(MockScaffolderTemporalClient)
	m.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-gone").
		Return("", ErrScaffolderRunNotFound)

	server := NewTemplateServer(m, nil)
	_, err := server.GetRunProgress(authCtx(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-gone"}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeNotFound, connectCode(t, err))
}

func TestScaffolderRunHandlers_RejectAnUnauthenticatedCaller(t *testing.T) {
	m := new(MockScaffolderTemporalClient)
	m.On("ScaffolderRunWorkspace", mock.Anything, "scaffolder-run-1").Return("ws-1", nil)

	server := NewTemplateServer(m, nil)
	_, err := server.GetRunProgress(context.Background(), connect.NewRequest(&templatev1.GetRunProgressRequest{WorkflowId: "scaffolder-run-1"}))

	require.Error(t, err)
	assert.Equal(t, connect.CodePermissionDenied, connectCode(t, err))
	m.AssertNotCalled(t, "QueryScaffolderProgress", mock.Anything, mock.Anything)
}
