package grpc

import (
	"context"

	"connectrpc.com/connect"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/template/v1/templatev1connect"
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

// TemplateServer implements the TemplateService Connect/gRPC server
type TemplateServer struct {
	templatev1connect.UnimplementedTemplateServiceHandler
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
func (s *TemplateServer) StartInstantiation(ctx context.Context, req *connect.Request[templatev1.StartInstantiationRequest]) (*connect.Response[templatev1.StartInstantiationResponse], error) {
	msg := req.Msg
	// Validate required fields
	if msg.TemplateId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	if msg.WorkspaceId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	if msg.TargetOrg == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	if msg.RepositoryName == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Start the Temporal workflow
	workflowID, err := s.temporalClient.StartTemplateWorkflow(ctx, msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&templatev1.StartInstantiationResponse{
		WorkflowId: workflowID,
	}), nil
}

// GetInstantiationProgress retrieves the current progress of an instantiation workflow
func (s *TemplateServer) GetInstantiationProgress(ctx context.Context, req *connect.Request[templatev1.GetProgressRequest]) (*connect.Response[templatev1.GetProgressResponse], error) {
	msg := req.Msg
	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Query the workflow for progress
	result, err := s.temporalClient.QueryWorkflow(ctx, msg.WorkflowId, "progress")
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Parse the result
	progressData, ok := result.(map[string]interface{})
	if !ok {
		return nil, connect.NewError(connect.CodeInternal, nil)
	}

	resp := &templatev1.GetProgressResponse{
		WorkflowId: msg.WorkflowId,
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

	return connect.NewResponse(resp), nil
}

// CancelInstantiation cancels an in-progress instantiation workflow
func (s *TemplateServer) CancelInstantiation(ctx context.Context, req *connect.Request[templatev1.CancelRequest]) (*connect.Response[templatev1.CancelResponse], error) {
	msg := req.Msg
	// Validate required fields
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Cancel the workflow
	err := s.temporalClient.CancelWorkflow(ctx, msg.WorkflowId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&templatev1.CancelResponse{
		Success: true,
	}), nil
}

// ListAvailableOrgs lists available GitHub organizations for a workspace
func (s *TemplateServer) ListAvailableOrgs(ctx context.Context, req *connect.Request[templatev1.ListAvailableOrgsRequest]) (*connect.Response[templatev1.ListAvailableOrgsResponse], error) {
	msg := req.Msg
	// Validate required fields
	if msg.WorkspaceId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Get installations from Payload
	installations, err := s.payloadClient.ListWorkspaceInstallations(ctx, msg.WorkspaceId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
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

	return connect.NewResponse(&templatev1.ListAvailableOrgsResponse{
		Orgs: orgs,
	}), nil
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
