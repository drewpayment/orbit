package grpc

import (
	"context"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/build/v1/buildv1connect"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// BuildClientInterface defines the interface for build workflow operations
type BuildClientInterface interface {
	StartBuildWorkflow(ctx context.Context, input *types.BuildWorkflowInput) (string, error)
	QueryBuildWorkflow(ctx context.Context, workflowID, queryType string) (*types.BuildProgress, error)
}

// BuildServer implements the BuildService Connect/gRPC server for workflow operations
type BuildServer struct {
	buildv1connect.UnimplementedBuildServiceHandler
	temporalClient BuildClientInterface
	logger         *slog.Logger
}

// NewBuildServer creates a new BuildServer instance
func NewBuildServer(temporalClient BuildClientInterface, logger *slog.Logger) *BuildServer {
	if logger == nil {
		logger = slog.Default()
	}
	return &BuildServer{
		temporalClient: temporalClient,
		logger:         logger,
	}
}

// StartBuildWorkflow initiates a new build workflow
func (s *BuildServer) StartBuildWorkflow(ctx context.Context, req *connect.Request[buildv1.StartBuildWorkflowRequest]) (*connect.Response[buildv1.StartBuildWorkflowResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.AppId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("app_id is required"))
	}
	if msg.WorkspaceId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workspace_id is required"))
	}
	if msg.RepoUrl == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("repo_url is required"))
	}
	if msg.Registry == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("registry is required"))
	}

	// Default ref to main if not provided
	ref := msg.Ref
	if ref == "" {
		ref = "main"
	}

	// Default image tag
	imageTag := msg.ImageTag
	if imageTag == "" {
		imageTag = "latest"
	}

	// Convert registry type
	var registryType string
	switch msg.Registry.Type {
	case buildv1.RegistryType_REGISTRY_TYPE_GHCR:
		registryType = "ghcr"
	case buildv1.RegistryType_REGISTRY_TYPE_ACR:
		registryType = "acr"
	case buildv1.RegistryType_REGISTRY_TYPE_ORBIT:
		registryType = "orbit"
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unsupported registry type"))
	}

	// Build registry config
	s.logger.Info("Received registry config",
		"type", registryType,
		"url", msg.Registry.Url,
		"repository", msg.Registry.Repository,
		"tokenLength", len(msg.Registry.Token),
		"tokenPrefix", msg.Registry.Token[:min(10, len(msg.Registry.Token))]+"...",
	)

	registryConfig := types.BuildRegistryConfig{
		Type:       registryType,
		URL:        msg.Registry.Url,
		Repository: msg.Registry.Repository,
		Token:      msg.Registry.Token,
	}
	if msg.Registry.Username != nil {
		registryConfig.Username = *msg.Registry.Username
	}

	// Create workflow input
	workflowInput := &types.BuildWorkflowInput{
		AppID:             msg.AppId,
		WorkspaceID:       msg.WorkspaceId,
		UserID:            msg.UserId,
		RepoURL:           msg.RepoUrl,
		Ref:               ref,
		Registry:          registryConfig,
		BuildEnv:          msg.BuildEnv,
		ImageTag:          imageTag,
		InstallationToken: msg.InstallationToken,
	}

	// Handle optional overrides
	if msg.LanguageVersion != nil {
		workflowInput.LanguageVersion = *msg.LanguageVersion
	}
	if msg.BuildCommand != nil {
		workflowInput.BuildCommand = *msg.BuildCommand
	}
	if msg.StartCommand != nil {
		workflowInput.StartCommand = *msg.StartCommand
	}

	// Start the Temporal workflow
	workflowID, err := s.temporalClient.StartBuildWorkflow(ctx, workflowInput)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start build workflow: %w", err))
	}

	return connect.NewResponse(&buildv1.StartBuildWorkflowResponse{
		Success:    true,
		WorkflowId: workflowID,
	}), nil
}

// GetBuildProgress retrieves the current progress of a build workflow
func (s *BuildServer) GetBuildProgress(ctx context.Context, req *connect.Request[buildv1.GetBuildProgressRequest]) (*connect.Response[buildv1.GetBuildProgressResponse], error) {
	msg := req.Msg

	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("workflow_id is required"))
	}

	// Query the workflow for progress
	progress, err := s.temporalClient.QueryBuildWorkflow(ctx, msg.WorkflowId, "progress")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to query build progress: %w", err))
	}

	// Build response
	resp := &buildv1.GetBuildProgressResponse{
		CurrentStep:  progress.CurrentStep,
		StepsTotal:   int32(progress.StepsTotal),
		StepsCurrent: int32(progress.StepsCurrent),
		Message:      progress.Message,
		Status:       getBuildStatusString(progress),
	}

	return connect.NewResponse(resp), nil
}

// getBuildStatusString converts progress data to a status string
func getBuildStatusString(progress *types.BuildProgress) string {
	switch progress.CurrentStep {
	case "completed":
		return "success"
	case "failed":
		return "failed"
	case "initializing", "":
		return "pending"
	default:
		return "running"
	}
}

// AnalyzeRepository is not implemented here (handled by build-service directly)
func (s *BuildServer) AnalyzeRepository(ctx context.Context, req *connect.Request[buildv1.AnalyzeRepositoryRequest]) (*connect.Response[buildv1.AnalyzeRepositoryResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("AnalyzeRepository not implemented in repository-service; use build-service directly"))
}

// BuildImage is not implemented here (handled by build-service directly)
func (s *BuildServer) BuildImage(ctx context.Context, req *connect.Request[buildv1.BuildImageRequest]) (*connect.Response[buildv1.BuildImageResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("BuildImage not implemented in repository-service; use build-service directly"))
}

// StreamBuildLogs is not implemented here (handled by build-service directly)
func (s *BuildServer) StreamBuildLogs(ctx context.Context, req *connect.Request[buildv1.StreamBuildLogsRequest], stream *connect.ServerStream[buildv1.StreamBuildLogsResponse]) error {
	return connect.NewError(connect.CodeUnimplemented, fmt.Errorf("StreamBuildLogs not implemented in repository-service; use build-service directly"))
}
