package grpc

import (
	"context"
	"encoding/json"
	"fmt"

	"connectrpc.com/connect"

	deploymentv1 "github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/deployment/v1/deploymentv1connect"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// DeploymentClientInterface defines the interface for deployment workflow operations
type DeploymentClientInterface interface {
	StartDeploymentWorkflow(ctx context.Context, input *types.DeploymentWorkflowInput) (string, error)
	QueryDeploymentWorkflow(ctx context.Context, workflowID, queryType string) (*types.DeploymentProgress, error)
}

// DeploymentServer implements the DeploymentService Connect/gRPC server
type DeploymentServer struct {
	deploymentv1connect.UnimplementedDeploymentServiceHandler
	temporalClient DeploymentClientInterface
}

// NewDeploymentServer creates a new DeploymentServer instance
func NewDeploymentServer(temporalClient DeploymentClientInterface) *DeploymentServer {
	return &DeploymentServer{
		temporalClient: temporalClient,
	}
}

// StartDeploymentWorkflow initiates a new deployment workflow
func (s *DeploymentServer) StartDeploymentWorkflow(ctx context.Context, req *connect.Request[deploymentv1.StartDeploymentWorkflowRequest]) (*connect.Response[deploymentv1.StartDeploymentWorkflowResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.DeploymentId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("deployment_id is required"))
	}
	if msg.AppId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("app_id is required"))
	}
	if msg.WorkspaceId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workspace_id is required"))
	}
	if msg.GeneratorType == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("generator_type is required"))
	}
	if msg.GeneratorSlug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("generator_slug is required"))
	}

	// Convert google.protobuf.Struct config to JSON bytes
	var configBytes []byte
	var err error
	if msg.Config != nil {
		configBytes, err = json.Marshal(msg.Config.AsMap())
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid config: %w", err))
		}
	}

	// Convert proto DeploymentTarget to workflow input
	var target types.DeploymentTargetInput
	if msg.Target != nil {
		target = types.DeploymentTargetInput{
			Type:    msg.Target.Type,
			Region:  msg.Target.Region,
			Cluster: msg.Target.Cluster,
			HostURL: msg.Target.HostUrl,
		}
	}

	// Create workflow input
	workflowInput := &types.DeploymentWorkflowInput{
		DeploymentID:  msg.DeploymentId,
		AppID:         msg.AppId,
		WorkspaceID:   msg.WorkspaceId,
		UserID:        msg.UserId,
		GeneratorType: msg.GeneratorType,
		GeneratorSlug: msg.GeneratorSlug,
		Config:        configBytes,
		Target:        target,
		Mode:          msg.Mode,
	}

	// Start the Temporal workflow
	workflowID, err := s.temporalClient.StartDeploymentWorkflow(ctx, workflowInput)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start deployment workflow: %w", err))
	}

	return connect.NewResponse(&deploymentv1.StartDeploymentWorkflowResponse{
		WorkflowId: workflowID,
		Success:    true,
	}), nil
}

// GetDeploymentProgress retrieves the current progress of a deployment workflow
func (s *DeploymentServer) GetDeploymentProgress(ctx context.Context, req *connect.Request[deploymentv1.GetDeploymentProgressRequest]) (*connect.Response[deploymentv1.GetDeploymentProgressResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	// Query the workflow for progress
	progress, err := s.temporalClient.QueryDeploymentWorkflow(ctx, msg.WorkflowId, "progress")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to query deployment progress: %w", err))
	}

	// Build response from progress data
	resp := &deploymentv1.GetDeploymentProgressResponse{
		CurrentStep:  progress.CurrentStep,
		StepsTotal:   int32(progress.StepsTotal),
		StepsCurrent: int32(progress.StepsCurrent),
		Message:      progress.Message,
		Status:       getDeploymentStatusString(progress),
	}

	// Include generated files if available
	if len(progress.GeneratedFiles) > 0 {
		resp.GeneratedFiles = make([]*deploymentv1.GeneratedFile, len(progress.GeneratedFiles))
		for i, f := range progress.GeneratedFiles {
			resp.GeneratedFiles[i] = &deploymentv1.GeneratedFile{
				Path:    f.Path,
				Content: f.Content,
			}
		}
	}

	return connect.NewResponse(resp), nil
}

// getDeploymentStatusString converts progress data to a status string
func getDeploymentStatusString(progress *types.DeploymentProgress) string {
	if progress.CurrentStep == "completed" {
		return "completed"
	}
	if progress.CurrentStep == "failed" {
		return "failed"
	}
	if progress.CurrentStep == "initializing" || progress.CurrentStep == "" {
		return "pending"
	}
	return "running"
}
