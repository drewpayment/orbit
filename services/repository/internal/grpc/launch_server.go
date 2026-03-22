package grpc

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	launchv1 "github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/launch/v1/launchv1connect"
)

// LaunchClientInterface defines the interface for launch workflow operations
type LaunchClientInterface interface {
	StartLaunchWorkflow(ctx context.Context, input *StartLaunchInput) (string, error)
	QueryLaunchProgress(ctx context.Context, workflowID string) (*LaunchProgressResult, error)
	SignalLaunchApproval(ctx context.Context, workflowID string, approved bool, approvedBy, notes string) error
	SignalLaunchDeorbit(ctx context.Context, workflowID string, requestedBy, reason string) error
	SignalLaunchAbort(ctx context.Context, workflowID string, requestedBy string) error
	StartDeployToLaunchWorkflow(ctx context.Context, input *DeployToLaunchInput) (string, error)
}

// StartLaunchInput contains the inputs for starting a launch workflow
type StartLaunchInput struct {
	LaunchID          string
	TemplateSlug      string
	CloudAccountID    string
	Provider          string
	Region            string
	Parameters        map[string]interface{}
	ApprovalRequired  bool
	PulumiProjectPath string
	WorkspaceID       string
	AutoApproved      bool
	LaunchedBy        string
}

// DeployToLaunchInput contains inputs for deploying an app to Launch infrastructure
type DeployToLaunchInput struct {
	DeploymentID    string
	LaunchID        string
	Strategy        string
	CloudAccountID  string
	Provider        string
	RepoURL         string
	Branch          string
	BuildCommand    string
	OutputDirectory string
	LaunchOutputs   map[string]interface{}
	BuildEnv        map[string]string
}

// LaunchProgressResult contains the progress data from a launch workflow query
type LaunchProgressResult struct {
	Status      string
	CurrentStep int
	TotalSteps  int
	Message     string
	Percentage  float64
	Logs        []string
}

// LaunchServer implements the LaunchService Connect/gRPC server
type LaunchServer struct {
	launchv1connect.UnimplementedLaunchServiceHandler
	temporalClient LaunchClientInterface
}

// NewLaunchServer creates a new LaunchServer instance
func NewLaunchServer(temporalClient LaunchClientInterface) *LaunchServer {
	return &LaunchServer{
		temporalClient: temporalClient,
	}
}

// StartLaunch initiates a new launch workflow
func (s *LaunchServer) StartLaunch(ctx context.Context, req *connect.Request[launchv1.StartLaunchRequest]) (*connect.Response[launchv1.StartLaunchResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.LaunchId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("launch_id is required"))
	}
	if msg.TemplateSlug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("template_slug is required"))
	}
	if msg.CloudAccountId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cloud_account_id is required"))
	}
	if msg.Provider == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("provider is required"))
	}
	if msg.Region == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("region is required"))
	}

	// Convert proto Struct parameters to map
	var params map[string]interface{}
	if msg.Parameters != nil {
		params = msg.Parameters.AsMap()
	}

	// Create workflow input
	input := &StartLaunchInput{
		LaunchID:          msg.LaunchId,
		TemplateSlug:      msg.TemplateSlug,
		CloudAccountID:    msg.CloudAccountId,
		Provider:          msg.Provider,
		Region:            msg.Region,
		Parameters:        params,
		ApprovalRequired:  msg.ApprovalRequired,
		PulumiProjectPath: msg.PulumiProjectPath,
		WorkspaceID:       msg.WorkspaceId,
		AutoApproved:      msg.AutoApproved,
		LaunchedBy:        msg.LaunchedBy,
	}

	// Start the Temporal workflow
	workflowID, err := s.temporalClient.StartLaunchWorkflow(ctx, input)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start launch workflow: %w", err))
	}

	return connect.NewResponse(&launchv1.StartLaunchResponse{
		WorkflowId: workflowID,
		Success:    true,
	}), nil
}

// GetLaunchProgress retrieves the current progress of a launch workflow
func (s *LaunchServer) GetLaunchProgress(ctx context.Context, req *connect.Request[launchv1.GetLaunchProgressRequest]) (*connect.Response[launchv1.GetLaunchProgressResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	// Query the workflow for progress
	progress, err := s.temporalClient.QueryLaunchProgress(ctx, msg.WorkflowId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to query launch progress: %w", err))
	}

	return connect.NewResponse(&launchv1.GetLaunchProgressResponse{
		Status:      progress.Status,
		CurrentStep: int32(progress.CurrentStep),
		TotalSteps:  int32(progress.TotalSteps),
		Message:     progress.Message,
		Percentage:  float32(progress.Percentage),
		Logs:        progress.Logs,
	}), nil
}

// ApproveLaunch sends an approval signal to a launch workflow
func (s *LaunchServer) ApproveLaunch(ctx context.Context, req *connect.Request[launchv1.ApproveLaunchRequest]) (*connect.Response[launchv1.ApproveLaunchResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	// Send approval signal
	err := s.temporalClient.SignalLaunchApproval(ctx, msg.WorkflowId, msg.Approved, msg.ApprovedBy, msg.Notes)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send approval signal: %w", err))
	}

	return connect.NewResponse(&launchv1.ApproveLaunchResponse{
		Success: true,
	}), nil
}

// DeorbitLaunch sends a deorbit signal to a launch workflow
func (s *LaunchServer) DeorbitLaunch(ctx context.Context, req *connect.Request[launchv1.DeorbitLaunchRequest]) (*connect.Response[launchv1.DeorbitLaunchResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	// Send deorbit signal
	err := s.temporalClient.SignalLaunchDeorbit(ctx, msg.WorkflowId, msg.RequestedBy, msg.Reason)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send deorbit signal: %w", err))
	}

	return connect.NewResponse(&launchv1.DeorbitLaunchResponse{
		Success: true,
	}), nil
}

// AbortLaunch sends an abort signal to a launch workflow
func (s *LaunchServer) AbortLaunch(ctx context.Context, req *connect.Request[launchv1.AbortLaunchRequest]) (*connect.Response[launchv1.AbortLaunchResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	// Send abort signal
	err := s.temporalClient.SignalLaunchAbort(ctx, msg.WorkflowId, msg.RequestedBy)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send abort signal: %w", err))
	}

	return connect.NewResponse(&launchv1.AbortLaunchResponse{
		Success: true,
	}), nil
}

// DeployToLaunch starts a deploy-to-launch workflow
func (s *LaunchServer) DeployToLaunch(ctx context.Context, req *connect.Request[launchv1.DeployToLaunchRequest]) (*connect.Response[launchv1.DeployToLaunchResponse], error) {
	msg := req.Msg

	if msg.DeploymentId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("deployment_id is required"))
	}
	if msg.LaunchId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("launch_id is required"))
	}
	if msg.Strategy == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("strategy is required"))
	}

	var launchOutputs map[string]interface{}
	if msg.LaunchOutputs != nil {
		launchOutputs = msg.LaunchOutputs.AsMap()
	}

	input := &DeployToLaunchInput{
		DeploymentID:    msg.DeploymentId,
		LaunchID:        msg.LaunchId,
		Strategy:        msg.Strategy,
		CloudAccountID:  msg.CloudAccountId,
		Provider:        msg.Provider,
		RepoURL:         msg.RepoUrl,
		Branch:          msg.Branch,
		BuildCommand:    msg.BuildCommand,
		OutputDirectory: msg.OutputDirectory,
		LaunchOutputs:   launchOutputs,
		BuildEnv:        msg.BuildEnv,
	}

	workflowID, err := s.temporalClient.StartDeployToLaunchWorkflow(ctx, input)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start deploy-to-launch workflow: %w", err))
	}

	return connect.NewResponse(&launchv1.DeployToLaunchResponse{
		WorkflowId: workflowID,
		Success:    true,
	}), nil
}
