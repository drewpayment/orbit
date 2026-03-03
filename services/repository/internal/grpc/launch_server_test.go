package grpc

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	launchv1 "github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1"
)

// mockLaunchClient implements LaunchClientInterface for testing.
type mockLaunchClient struct {
	startWorkflowFn     func(ctx context.Context, input *StartLaunchInput) (string, error)
	queryProgressFn     func(ctx context.Context, workflowID string) (*LaunchProgressResult, error)
	signalApprovalFn    func(ctx context.Context, workflowID string, approved bool, approvedBy, notes string) error
	signalDeorbitFn     func(ctx context.Context, workflowID string, requestedBy, reason string) error
	signalAbortFn       func(ctx context.Context, workflowID string, requestedBy string) error
}

func (m *mockLaunchClient) StartLaunchWorkflow(ctx context.Context, input *StartLaunchInput) (string, error) {
	if m.startWorkflowFn != nil {
		return m.startWorkflowFn(ctx, input)
	}
	return "wf-123", nil
}

func (m *mockLaunchClient) QueryLaunchProgress(ctx context.Context, workflowID string) (*LaunchProgressResult, error) {
	if m.queryProgressFn != nil {
		return m.queryProgressFn(ctx, workflowID)
	}
	return &LaunchProgressResult{}, nil
}

func (m *mockLaunchClient) SignalLaunchApproval(ctx context.Context, workflowID string, approved bool, approvedBy, notes string) error {
	if m.signalApprovalFn != nil {
		return m.signalApprovalFn(ctx, workflowID, approved, approvedBy, notes)
	}
	return nil
}

func (m *mockLaunchClient) SignalLaunchDeorbit(ctx context.Context, workflowID string, requestedBy, reason string) error {
	if m.signalDeorbitFn != nil {
		return m.signalDeorbitFn(ctx, workflowID, requestedBy, reason)
	}
	return nil
}

func (m *mockLaunchClient) SignalLaunchAbort(ctx context.Context, workflowID string, requestedBy string) error {
	if m.signalAbortFn != nil {
		return m.signalAbortFn(ctx, workflowID, requestedBy)
	}
	return nil
}

// --- StartLaunch Tests ---

func TestStartLaunch_Success(t *testing.T) {
	client := &mockLaunchClient{
		startWorkflowFn: func(_ context.Context, input *StartLaunchInput) (string, error) {
			assert.Equal(t, "launch-001", input.LaunchID)
			assert.Equal(t, "s3-bucket", input.TemplateSlug)
			assert.Equal(t, "aws", input.Provider)
			return "wf-launch-001", nil
		},
	}
	server := NewLaunchServer(client)

	resp, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		LaunchId:       "launch-001",
		TemplateSlug:   "s3-bucket",
		CloudAccountId: "acct-1",
		Provider:       "aws",
		Region:         "us-east-1",
	}))

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "wf-launch-001", resp.Msg.WorkflowId)
	assert.True(t, resp.Msg.Success)
}

func TestStartLaunch_MissingLaunchID(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		TemplateSlug:   "s3-bucket",
		CloudAccountId: "acct-1",
		Provider:       "aws",
		Region:         "us-east-1",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "launch_id")
}

func TestStartLaunch_MissingTemplateSlug(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		LaunchId:       "launch-001",
		CloudAccountId: "acct-1",
		Provider:       "aws",
		Region:         "us-east-1",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "template_slug")
}

func TestStartLaunch_MissingCloudAccountID(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		LaunchId:     "launch-001",
		TemplateSlug: "s3-bucket",
		Provider:     "aws",
		Region:       "us-east-1",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "cloud_account_id")
}

func TestStartLaunch_MissingProvider(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		LaunchId:       "launch-001",
		TemplateSlug:   "s3-bucket",
		CloudAccountId: "acct-1",
		Region:         "us-east-1",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "provider")
}

func TestStartLaunch_MissingRegion(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		LaunchId:       "launch-001",
		TemplateSlug:   "s3-bucket",
		CloudAccountId: "acct-1",
		Provider:       "aws",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "region")
}

func TestStartLaunch_WorkflowError(t *testing.T) {
	client := &mockLaunchClient{
		startWorkflowFn: func(_ context.Context, _ *StartLaunchInput) (string, error) {
			return "", fmt.Errorf("temporal unavailable")
		},
	}
	server := NewLaunchServer(client)

	_, err := server.StartLaunch(context.Background(), connect.NewRequest(&launchv1.StartLaunchRequest{
		LaunchId:       "launch-001",
		TemplateSlug:   "s3-bucket",
		CloudAccountId: "acct-1",
		Provider:       "aws",
		Region:         "us-east-1",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "failed to start launch workflow")
}

// --- GetLaunchProgress Tests ---

func TestGetLaunchProgress_Success(t *testing.T) {
	client := &mockLaunchClient{
		queryProgressFn: func(_ context.Context, workflowID string) (*LaunchProgressResult, error) {
			assert.Equal(t, "wf-123", workflowID)
			return &LaunchProgressResult{
				Status:      "launching",
				CurrentStep: 3,
				TotalSteps:  5,
				Message:     "Provisioning infrastructure",
				Percentage:  40,
				Logs:        []string{"Step 1 done", "Step 2 done"},
			}, nil
		},
	}
	server := NewLaunchServer(client)

	resp, err := server.GetLaunchProgress(context.Background(), connect.NewRequest(&launchv1.GetLaunchProgressRequest{
		WorkflowId: "wf-123",
	}))

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, "launching", resp.Msg.Status)
	assert.Equal(t, int32(3), resp.Msg.CurrentStep)
	assert.Equal(t, int32(5), resp.Msg.TotalSteps)
	assert.Equal(t, "Provisioning infrastructure", resp.Msg.Message)
	assert.Equal(t, float32(40), resp.Msg.Percentage)
	assert.Len(t, resp.Msg.Logs, 2)
}

func TestGetLaunchProgress_MissingWorkflowID(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.GetLaunchProgress(context.Background(), connect.NewRequest(&launchv1.GetLaunchProgressRequest{}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "workflow_id")
}

func TestGetLaunchProgress_QueryError(t *testing.T) {
	client := &mockLaunchClient{
		queryProgressFn: func(_ context.Context, _ string) (*LaunchProgressResult, error) {
			return nil, fmt.Errorf("workflow not found")
		},
	}
	server := NewLaunchServer(client)

	_, err := server.GetLaunchProgress(context.Background(), connect.NewRequest(&launchv1.GetLaunchProgressRequest{
		WorkflowId: "wf-nonexistent",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connect.CodeOf(err))
}

// --- ApproveLaunch Tests ---

func TestApproveLaunch_Success(t *testing.T) {
	client := &mockLaunchClient{
		signalApprovalFn: func(_ context.Context, workflowID string, approved bool, approvedBy, notes string) error {
			assert.Equal(t, "wf-123", workflowID)
			assert.True(t, approved)
			assert.Equal(t, "admin@test.com", approvedBy)
			assert.Equal(t, "Approved for production", notes)
			return nil
		},
	}
	server := NewLaunchServer(client)

	resp, err := server.ApproveLaunch(context.Background(), connect.NewRequest(&launchv1.ApproveLaunchRequest{
		WorkflowId: "wf-123",
		Approved:   true,
		ApprovedBy: "admin@test.com",
		Notes:      "Approved for production",
	}))

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Msg.Success)
}

func TestApproveLaunch_MissingWorkflowID(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.ApproveLaunch(context.Background(), connect.NewRequest(&launchv1.ApproveLaunchRequest{
		Approved:   true,
		ApprovedBy: "admin@test.com",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "workflow_id")
}

func TestApproveLaunch_SignalError(t *testing.T) {
	client := &mockLaunchClient{
		signalApprovalFn: func(_ context.Context, _ string, _ bool, _, _ string) error {
			return fmt.Errorf("workflow already completed")
		},
	}
	server := NewLaunchServer(client)

	_, err := server.ApproveLaunch(context.Background(), connect.NewRequest(&launchv1.ApproveLaunchRequest{
		WorkflowId: "wf-123",
		Approved:   true,
		ApprovedBy: "admin@test.com",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connect.CodeOf(err))
}

// --- DeorbitLaunch Tests ---

func TestDeorbitLaunch_Success(t *testing.T) {
	client := &mockLaunchClient{
		signalDeorbitFn: func(_ context.Context, workflowID, requestedBy, reason string) error {
			assert.Equal(t, "wf-123", workflowID)
			assert.Equal(t, "ops-team", requestedBy)
			assert.Equal(t, "no longer needed", reason)
			return nil
		},
	}
	server := NewLaunchServer(client)

	resp, err := server.DeorbitLaunch(context.Background(), connect.NewRequest(&launchv1.DeorbitLaunchRequest{
		WorkflowId:  "wf-123",
		RequestedBy: "ops-team",
		Reason:      "no longer needed",
	}))

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Msg.Success)
}

func TestDeorbitLaunch_MissingWorkflowID(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.DeorbitLaunch(context.Background(), connect.NewRequest(&launchv1.DeorbitLaunchRequest{
		RequestedBy: "ops-team",
		Reason:      "cleanup",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "workflow_id")
}

func TestDeorbitLaunch_SignalError(t *testing.T) {
	client := &mockLaunchClient{
		signalDeorbitFn: func(_ context.Context, _, _, _ string) error {
			return fmt.Errorf("workflow not found")
		},
	}
	server := NewLaunchServer(client)

	_, err := server.DeorbitLaunch(context.Background(), connect.NewRequest(&launchv1.DeorbitLaunchRequest{
		WorkflowId:  "wf-123",
		RequestedBy: "ops-team",
		Reason:      "cleanup",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connect.CodeOf(err))
}

// --- AbortLaunch Tests ---

func TestAbortLaunch_Success(t *testing.T) {
	client := &mockLaunchClient{
		signalAbortFn: func(_ context.Context, workflowID, requestedBy string) error {
			assert.Equal(t, "wf-123", workflowID)
			assert.Equal(t, "admin", requestedBy)
			return nil
		},
	}
	server := NewLaunchServer(client)

	resp, err := server.AbortLaunch(context.Background(), connect.NewRequest(&launchv1.AbortLaunchRequest{
		WorkflowId:  "wf-123",
		RequestedBy: "admin",
	}))

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Msg.Success)
}

func TestAbortLaunch_MissingWorkflowID(t *testing.T) {
	server := NewLaunchServer(nil)

	_, err := server.AbortLaunch(context.Background(), connect.NewRequest(&launchv1.AbortLaunchRequest{
		RequestedBy: "admin",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
	assert.Contains(t, err.Error(), "workflow_id")
}

func TestAbortLaunch_SignalError(t *testing.T) {
	client := &mockLaunchClient{
		signalAbortFn: func(_ context.Context, _, _ string) error {
			return fmt.Errorf("workflow not found")
		},
	}
	server := NewLaunchServer(client)

	_, err := server.AbortLaunch(context.Background(), connect.NewRequest(&launchv1.AbortLaunchRequest{
		WorkflowId:  "wf-123",
		RequestedBy: "admin",
	}))

	require.Error(t, err)
	assert.Equal(t, connect.CodeInternal, connect.CodeOf(err))
}
