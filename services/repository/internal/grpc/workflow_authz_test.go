package grpc

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	deploymentv1 "github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1"
	launchv1 "github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1"
	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// callerCase is one caller identity and the Connect code a guarded RPC must
// answer with when the workflow belongs to testWS. want == 0 means allowed.
type callerCase struct {
	name string
	ctx  context.Context
	want connect.Code
}

// guardCases are the identities every object-addressed RPC is tried with for a
// workflow owned by testWS.
func guardCases() []callerCase {
	return []callerCase{
		{"owning workspace", ctxFor(testWS, false), 0},
		{"another tenant", ctxFor("ws-evil", false), connect.CodePermissionDenied},
		{"token without workspace claim", ctxFor("", false), connect.CodePermissionDenied},
		{"platform admin without workspace claim", ctxFor("", true), 0},
		{"no identity at all", context.Background(), connect.CodePermissionDenied},
	}
}

func assertCode(t *testing.T, want connect.Code, err error) {
	t.Helper()
	if want == 0 {
		assert.NoError(t, err)
		return
	}
	require.Error(t, err)
	assert.Equal(t, want, connect.CodeOf(err), "err: %v", err)
}

// --- launch: ApproveLaunch / AbortLaunch / DeorbitLaunch / GetLaunchProgress ---

func TestLaunchObjectRPCs_TenantIsolation(t *testing.T) {
	type rpc struct {
		name    string
		call    func(s *LaunchServer, ctx context.Context, wf string) error
		touched func(c *mockLaunchClient) bool
	}
	rpcs := []rpc{
		{"ApproveLaunch", func(s *LaunchServer, ctx context.Context, wf string) error {
			_, err := s.ApproveLaunch(ctx, connect.NewRequest(&launchv1.ApproveLaunchRequest{WorkflowId: wf, Approved: true}))
			return err
		}, func(c *mockLaunchClient) bool { return c.signalled }},
		{"AbortLaunch", func(s *LaunchServer, ctx context.Context, wf string) error {
			_, err := s.AbortLaunch(ctx, connect.NewRequest(&launchv1.AbortLaunchRequest{WorkflowId: wf}))
			return err
		}, func(c *mockLaunchClient) bool { return c.signalled }},
		{"DeorbitLaunch", func(s *LaunchServer, ctx context.Context, wf string) error {
			_, err := s.DeorbitLaunch(ctx, connect.NewRequest(&launchv1.DeorbitLaunchRequest{WorkflowId: wf}))
			return err
		}, func(c *mockLaunchClient) bool { return c.signalled }},
		{"GetLaunchProgress", func(s *LaunchServer, ctx context.Context, wf string) error {
			_, err := s.GetLaunchProgress(ctx, connect.NewRequest(&launchv1.GetLaunchProgressRequest{WorkflowId: wf}))
			return err
		}, func(c *mockLaunchClient) bool { return c.queried }},
	}

	for _, r := range rpcs {
		for _, c := range guardCases() {
			t.Run(r.name+"/"+c.name, func(t *testing.T) {
				client := &mockLaunchClient{}
				err := r.call(NewLaunchServer(client), c.ctx, "launch-abc-1")

				assertCode(t, c.want, err)
				assert.Equal(t, c.want == 0, r.touched(client),
					"the workflow must be touched if and only if the caller is authorized")
			})
		}
	}
}

func TestLaunchObjectRPCs_WorkflowOwnershipResolution(t *testing.T) {
	tests := []struct {
		name     string
		resolve  func(context.Context, string) (string, error)
		ctx      context.Context
		workflow string
		want     connect.Code
	}{
		{"legacy workflow with no recorded owner is admin-only",
			func(context.Context, string) (string, error) { return "", nil },
			ctxFor(testWS, false), "launch-abc-1", connect.CodePermissionDenied},
		{"legacy workflow with no recorded owner, admin",
			func(context.Context, string) (string, error) { return "", nil },
			ctxFor("", true), "launch-abc-1", 0},
		{"unknown workflow",
			func(context.Context, string) (string, error) { return "", ErrWorkflowNotFound },
			ctxFor(testWS, false), "launch-abc-1", connect.CodeNotFound},
		{"resolver failure",
			func(context.Context, string) (string, error) { return "", errors.New("temporal down") },
			ctxFor(testWS, false), "launch-abc-1", connect.CodeInternal},
		{"workflow outside the launch- namespace",
			func(context.Context, string) (string, error) { return testWS, nil },
			ctxFor(testWS, false), "scaffolder-run-abc", connect.CodeInvalidArgument},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client := &mockLaunchClient{workflowWorkspaceFn: tc.resolve}
			_, err := NewLaunchServer(client).AbortLaunch(tc.ctx,
				connect.NewRequest(&launchv1.AbortLaunchRequest{WorkflowId: tc.workflow}))
			assertCode(t, tc.want, err)
			assert.Equal(t, tc.want == 0, client.signalled)
		})
	}
}

// noResolverLaunchClient implements LaunchClientInterface but not
// WorkflowWorkspaceResolver.
type noResolverLaunchClient struct{ LaunchClientInterface }

func TestLaunchObjectRPCs_ClientWithoutResolverFailsClosed(t *testing.T) {
	// A client that cannot report a workflow's workspace must not be served
	// unscoped, even to a platform admin.
	srv := NewLaunchServer(noResolverLaunchClient{})
	_, err := srv.AbortLaunch(ctxFor("", true), connect.NewRequest(&launchv1.AbortLaunchRequest{WorkflowId: "launch-abc-1"}))
	require.Error(t, err)
	assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
}

// --- launch: StartLaunch / DeployToLaunch ---

func TestStartLaunch_EnforcesBodyWorkspace(t *testing.T) {
	req := func(ws string) *connect.Request[launchv1.StartLaunchRequest] {
		return connect.NewRequest(&launchv1.StartLaunchRequest{
			LaunchId: "l1", TemplateSlug: "s", CloudAccountId: "a", Provider: "azure", Region: "r",
			WorkspaceId: ws,
		})
	}
	tests := []struct {
		name string
		ctx  context.Context
		body string
		want connect.Code
	}{
		{"own workspace", ctxFor(testWS, false), testWS, 0},
		{"another tenant's workspace", ctxFor("ws-evil", false), testWS, connect.CodePermissionDenied},
		{"workspace omitted from body", ctxFor(testWS, false), "", connect.CodePermissionDenied},
		{"workspace omitted, platform admin", ctxFor("", true), "", 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client := &mockLaunchClient{}
			_, err := NewLaunchServer(client).StartLaunch(tc.ctx, req(tc.body))
			assertCode(t, tc.want, err)
			assert.Equal(t, tc.want == 0, client.started)
		})
	}
}

func TestDeployToLaunch_RequiresWorkspaceScopedToken(t *testing.T) {
	req := connect.NewRequest(&launchv1.DeployToLaunchRequest{DeploymentId: "d1", LaunchId: "l1", Strategy: "static"})
	for _, c := range []callerCase{
		{"workspace token", ctxFor(testWS, false), 0},
		{"token without workspace claim", ctxFor("", false), connect.CodePermissionDenied},
		{"platform admin", ctxFor("", true), 0},
		{"no identity", context.Background(), connect.CodePermissionDenied},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := NewLaunchServer(&mockLaunchClient{}).DeployToLaunch(c.ctx, req)
			assertCode(t, c.want, err)
		})
	}
}

// --- deployment ---

type fakeDeploymentClient struct {
	owner   string
	started bool
	queried bool
}

func (f *fakeDeploymentClient) StartDeploymentWorkflow(context.Context, *types.DeploymentWorkflowInput) (string, error) {
	f.started = true
	return "deployment-1", nil
}
func (f *fakeDeploymentClient) QueryDeploymentWorkflow(context.Context, string, string) (*types.DeploymentProgress, error) {
	f.queried = true
	return &types.DeploymentProgress{}, nil
}
func (f *fakeDeploymentClient) WorkflowWorkspace(context.Context, string) (string, error) {
	return f.owner, nil
}

func TestDeploymentServer_TenantIsolation(t *testing.T) {
	t.Run("GetDeploymentProgress", func(t *testing.T) {
		for _, c := range guardCases() {
			t.Run(c.name, func(t *testing.T) {
				client := &fakeDeploymentClient{owner: testWS}
				_, err := NewDeploymentServer(client).GetDeploymentProgress(c.ctx,
					connect.NewRequest(&deploymentv1.GetDeploymentProgressRequest{WorkflowId: "deployment-d1"}))
				assertCode(t, c.want, err)
				assert.Equal(t, c.want == 0, client.queried)
			})
		}
	})

	t.Run("StartDeploymentWorkflow", func(t *testing.T) {
		start := func(ctx context.Context, ws string) (*fakeDeploymentClient, error) {
			client := &fakeDeploymentClient{}
			_, err := NewDeploymentServer(client).StartDeploymentWorkflow(ctx, connect.NewRequest(&deploymentv1.StartDeploymentWorkflowRequest{
				DeploymentId: "d1", AppId: "a1", WorkspaceId: ws, GeneratorType: "docker", GeneratorSlug: "g",
			}))
			return client, err
		}
		client, err := start(ctxFor("ws-evil", false), testWS)
		assertCode(t, connect.CodePermissionDenied, err)
		assert.False(t, client.started)

		client, err = start(ctxFor(testWS, false), testWS)
		assertCode(t, 0, err)
		assert.True(t, client.started)
	})
}

// --- build ---

type fakeBuildClient struct {
	owner   string
	started bool
	queried bool
}

func (f *fakeBuildClient) StartBuildWorkflow(context.Context, *types.BuildWorkflowInput) (string, error) {
	f.started = true
	return "build-1", nil
}
func (f *fakeBuildClient) QueryBuildWorkflow(context.Context, string, string) (*types.BuildProgress, error) {
	f.queried = true
	return &types.BuildProgress{}, nil
}
func (f *fakeBuildClient) WorkflowWorkspace(context.Context, string) (string, error) {
	return f.owner, nil
}

func TestBuildServer_TenantIsolation(t *testing.T) {
	t.Run("GetBuildProgress", func(t *testing.T) {
		for _, c := range guardCases() {
			t.Run(c.name, func(t *testing.T) {
				client := &fakeBuildClient{owner: testWS}
				_, err := NewBuildServer(client, nil).GetBuildProgress(c.ctx,
					connect.NewRequest(&buildv1.GetBuildProgressRequest{WorkflowId: "build-a1-1"}))
				assertCode(t, c.want, err)
				assert.Equal(t, c.want == 0, client.queried)
			})
		}
	})

	t.Run("StartBuildWorkflow", func(t *testing.T) {
		req := func(ws string) *connect.Request[buildv1.StartBuildWorkflowRequest] {
			return connect.NewRequest(&buildv1.StartBuildWorkflowRequest{
				AppId: "a1", WorkspaceId: ws, RepoUrl: "https://example.test/r.git",
				Registry: &buildv1.RegistryConfig{Type: buildv1.RegistryType_REGISTRY_TYPE_ORBIT, Url: "u", Repository: "r", Token: "t"},
			})
		}
		client := &fakeBuildClient{}
		_, err := NewBuildServer(client, nil).StartBuildWorkflow(ctxFor("ws-evil", false), req(testWS))
		assertCode(t, connect.CodePermissionDenied, err)
		assert.False(t, client.started)

		_, err = NewBuildServer(client, nil).StartBuildWorkflow(ctxFor(testWS, false), req(testWS))
		assertCode(t, 0, err)
		assert.True(t, client.started)
	})
}

// --- legacy template instantiation ---

func TestTemplateServer_LegacyInstantiationTenantIsolation(t *testing.T) {
	const wf = "template-instantiation-r-1"
	for _, c := range guardCases() {
		t.Run("GetInstantiationProgress/"+c.name, func(t *testing.T) {
			mt := new(MockTemporalClient)
			mt.On("QueryWorkflow", mock.Anything, wf, "progress").Maybe().
				Return(map[string]interface{}{"status": "running"}, nil)
			_, err := NewTemplateServer(mt, nil).GetInstantiationProgress(c.ctx,
				connect.NewRequest(&templatev1.GetProgressRequest{WorkflowId: wf}))
			assertCode(t, c.want, err)
			if c.want != 0 {
				mt.AssertNotCalled(t, "QueryWorkflow", mock.Anything, mock.Anything, mock.Anything)
			}
		})
		t.Run("CancelInstantiation/"+c.name, func(t *testing.T) {
			mt := new(MockTemporalClient)
			mt.On("CancelWorkflow", mock.Anything, wf).Maybe().Return(nil)
			_, err := NewTemplateServer(mt, nil).CancelInstantiation(c.ctx,
				connect.NewRequest(&templatev1.CancelRequest{WorkflowId: wf}))
			assertCode(t, c.want, err)
			if c.want != 0 {
				mt.AssertNotCalled(t, "CancelWorkflow", mock.Anything, mock.Anything)
			}
		})
	}

	t.Run("StartInstantiation rejects another tenant's workspace", func(t *testing.T) {
		mt := new(MockTemporalClient)
		_, err := NewTemplateServer(mt, nil).StartInstantiation(ctxFor("ws-evil", false),
			connect.NewRequest(&templatev1.StartInstantiationRequest{
				TemplateId: "t", WorkspaceId: testWS, TargetOrg: "o", RepositoryName: "r",
			}))
		assertCode(t, connect.CodePermissionDenied, err)
		mt.AssertNotCalled(t, "StartTemplateWorkflow", mock.Anything, mock.Anything)
	})

	t.Run("ListAvailableOrgs rejects another tenant's workspace", func(t *testing.T) {
		mp := new(MockPayloadClient)
		_, err := NewTemplateServer(nil, mp).ListAvailableOrgs(ctxFor("ws-evil", false),
			connect.NewRequest(&templatev1.ListAvailableOrgsRequest{WorkspaceId: testWS}))
		assertCode(t, connect.CodePermissionDenied, err)
		mp.AssertNotCalled(t, "ListWorkspaceInstallations", mock.Anything, mock.Anything)
	})
}
