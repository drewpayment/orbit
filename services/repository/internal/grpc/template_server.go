package grpc

import (
	"context"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TemporalClientInterface defines the interface for Temporal workflow operations
type TemporalClientInterface interface {
	StartTemplateWorkflow(ctx context.Context, input interface{}) (string, error)
	QueryWorkflow(ctx context.Context, workflowID, queryType string) (interface{}, error)
	CancelWorkflow(ctx context.Context, workflowID string) error
}

// PayloadClientInterface defines the interface for Payload CMS operations
type PayloadClientInterface interface {
	GetTemplate(ctx context.Context, templateID string) (*TemplateData, error)
	ListWorkspaceInstallations(ctx context.Context, workspaceID string) ([]*InstallationData, error)
}

// TemplateData represents template information from Payload CMS
type TemplateData struct {
	ID          string
	Name        string
	Description string
	RepoURL     string
}

// InstallationData represents a GitHub App installation
type InstallationData struct {
	OrgName        string
	AvatarURL      string
	InstallationID string
}

// TemplateServer implements the TemplateService gRPC server
type TemplateServer struct {
	templatev1.UnimplementedTemplateServiceServer
	temporalClient TemporalClientInterface
	payloadClient  PayloadClientInterface
}

// NewTemplateServer creates a new TemplateServer instance
func NewTemplateServer(temporalClient TemporalClientInterface, payloadClient PayloadClientInterface) *TemplateServer {
	return &TemplateServer{
		temporalClient: temporalClient,
		payloadClient:  payloadClient,
	}
}

// StartInstantiation initiates a new template instantiation workflow
func (s *TemplateServer) StartInstantiation(ctx context.Context, req *templatev1.StartInstantiationRequest) (*templatev1.StartInstantiationResponse, error) {
	// Validate required fields
	if req.TemplateId == "" {
		return nil, status.Error(codes.InvalidArgument, "template_id is required")
	}
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if req.TargetOrg == "" {
		return nil, status.Error(codes.InvalidArgument, "target_org is required")
	}
	if req.RepositoryName == "" {
		return nil, status.Error(codes.InvalidArgument, "repository_name is required")
	}

	// Start the Temporal workflow
	workflowID, err := s.temporalClient.StartTemplateWorkflow(ctx, req)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to start workflow: %v", err)
	}

	return &templatev1.StartInstantiationResponse{
		WorkflowId: workflowID,
	}, nil
}

// GetInstantiationProgress retrieves the current progress of an instantiation workflow
func (s *TemplateServer) GetInstantiationProgress(ctx context.Context, req *templatev1.GetProgressRequest) (*templatev1.GetProgressResponse, error) {
	// Validate required fields
	if req.WorkflowId == "" {
		return nil, status.Error(codes.InvalidArgument, "workflow_id is required")
	}

	// Query the workflow for progress
	result, err := s.temporalClient.QueryWorkflow(ctx, req.WorkflowId, "progress")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query workflow: %v", err)
	}

	// Parse the result
	progressData, ok := result.(map[string]interface{})
	if !ok {
		return nil, status.Error(codes.Internal, "invalid progress data format")
	}

	resp := &templatev1.GetProgressResponse{
		WorkflowId: req.WorkflowId,
	}

	// Extract current step
	if currentStep, ok := progressData["currentStep"].(string); ok {
		resp.CurrentStep = currentStep
	}

	// Extract progress percent
	if progressPercent, ok := progressData["progressPercent"].(int32); ok {
		resp.ProgressPercent = progressPercent
	}

	// Extract status
	if statusStr, ok := progressData["status"].(string); ok {
		resp.Status = parseWorkflowStatus(statusStr)
	}

	// Extract error message if present
	if errorMsg, ok := progressData["errorMessage"].(string); ok {
		resp.ErrorMessage = errorMsg
	}

	// Extract result repo URL if present
	if repoURL, ok := progressData["resultRepoUrl"].(string); ok {
		resp.ResultRepoUrl = repoURL
	}

	// Extract result repo name if present
	if repoName, ok := progressData["resultRepoName"].(string); ok {
		resp.ResultRepoName = repoName
	}

	return resp, nil
}

// CancelInstantiation cancels an in-progress instantiation workflow
func (s *TemplateServer) CancelInstantiation(ctx context.Context, req *templatev1.CancelRequest) (*templatev1.CancelResponse, error) {
	// Validate required fields
	if req.WorkflowId == "" {
		return nil, status.Error(codes.InvalidArgument, "workflow_id is required")
	}

	// Cancel the workflow
	err := s.temporalClient.CancelWorkflow(ctx, req.WorkflowId)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to cancel workflow: %v", err)
	}

	return &templatev1.CancelResponse{
		Success: true,
	}, nil
}

// ListAvailableOrgs lists available GitHub organizations for a workspace
func (s *TemplateServer) ListAvailableOrgs(ctx context.Context, req *templatev1.ListAvailableOrgsRequest) (*templatev1.ListAvailableOrgsResponse, error) {
	// Validate required fields
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}

	// Get installations from Payload
	installations, err := s.payloadClient.ListWorkspaceInstallations(ctx, req.WorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list installations: %v", err)
	}

	// Convert to response format
	orgs := make([]*templatev1.GitHubOrg, len(installations))
	for i, installation := range installations {
		orgs[i] = &templatev1.GitHubOrg{
			Name:           installation.OrgName,
			AvatarUrl:      installation.AvatarURL,
			InstallationId: installation.InstallationID,
		}
	}

	return &templatev1.ListAvailableOrgsResponse{
		Orgs: orgs,
	}, nil
}

// parseWorkflowStatus converts a status string to WorkflowStatus enum
func parseWorkflowStatus(statusStr string) templatev1.WorkflowStatus {
	switch statusStr {
	case "pending":
		return templatev1.WorkflowStatus_WORKFLOW_STATUS_PENDING
	case "running":
		return templatev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING
	case "completed":
		return templatev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED
	case "failed":
		return templatev1.WorkflowStatus_WORKFLOW_STATUS_FAILED
	case "cancelled":
		return templatev1.WorkflowStatus_WORKFLOW_STATUS_CANCELLED
	default:
		return templatev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED
	}
}
