package grpc

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
)

// MockTemporalClient is a mock for Temporal workflow operations
type MockTemporalClient struct {
	mock.Mock
}

func (m *MockTemporalClient) StartTemplateWorkflow(ctx context.Context, input interface{}) (string, error) {
	args := m.Called(ctx, input)
	return args.String(0), args.Error(1)
}

func (m *MockTemporalClient) QueryWorkflow(ctx context.Context, workflowID, queryType string) (interface{}, error) {
	args := m.Called(ctx, workflowID, queryType)
	return args.Get(0), args.Error(1)
}

func (m *MockTemporalClient) CancelWorkflow(ctx context.Context, workflowID string) error {
	args := m.Called(ctx, workflowID)
	return args.Error(0)
}

// MockPayloadClient is a mock for Payload CMS operations
type MockPayloadClient struct {
	mock.Mock
}

func (m *MockPayloadClient) GetTemplate(ctx context.Context, templateID string) (*TemplateData, error) {
	args := m.Called(ctx, templateID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*TemplateData), args.Error(1)
}

func (m *MockPayloadClient) ListWorkspaceInstallations(ctx context.Context, workspaceID string) ([]*InstallationData, error) {
	args := m.Called(ctx, workspaceID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*InstallationData), args.Error(1)
}

func TestStartInstantiation_Success(t *testing.T) {
	mockTemporal := new(MockTemporalClient)
	mockTemporal.On("StartTemplateWorkflow", mock.Anything, mock.Anything).
		Return("workflow-123", nil)

	server := NewTemplateServer(mockTemporal, nil)

	req := &templatev1.StartInstantiationRequest{
		TemplateId:     "template-1",
		WorkspaceId:    "workspace-1",
		TargetOrg:      "my-org",
		RepositoryName: "new-service",
		IsPrivate:      true,
		UserId:         "user-1",
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "workflow-123", resp.WorkflowId)
	mockTemporal.AssertExpectations(t)
}

func TestStartInstantiation_MissingTemplateID(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.StartInstantiationRequest{
		WorkspaceId:    "workspace-1",
		TargetOrg:      "my-org",
		RepositoryName: "new-service",
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "template_id")
}

func TestStartInstantiation_MissingWorkspaceID(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.StartInstantiationRequest{
		TemplateId:     "template-1",
		TargetOrg:      "my-org",
		RepositoryName: "new-service",
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "workspace_id")
}

func TestStartInstantiation_MissingTargetOrg(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.StartInstantiationRequest{
		TemplateId:     "template-1",
		WorkspaceId:    "workspace-1",
		RepositoryName: "new-service",
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "target_org")
}

func TestStartInstantiation_MissingRepositoryName(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.StartInstantiationRequest{
		TemplateId:  "template-1",
		WorkspaceId: "workspace-1",
		TargetOrg:   "my-org",
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "repository_name")
}

func TestGetInstantiationProgress_Success(t *testing.T) {
	mockTemporal := new(MockTemporalClient)
	mockTemporal.On("QueryWorkflow", mock.Anything, "workflow-123", "progress").
		Return(map[string]interface{}{
			"currentStep":     "creating_repository",
			"progressPercent": int32(50),
			"status":          "running",
		}, nil)

	server := NewTemplateServer(mockTemporal, nil)

	req := &templatev1.GetProgressRequest{
		WorkflowId: "workflow-123",
	}

	resp, err := server.GetInstantiationProgress(context.Background(), req)

	assert.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "workflow-123", resp.WorkflowId)
	assert.Equal(t, "creating_repository", resp.CurrentStep)
	assert.Equal(t, int32(50), resp.ProgressPercent)
	mockTemporal.AssertExpectations(t)
}

func TestGetInstantiationProgress_MissingWorkflowID(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.GetProgressRequest{}

	resp, err := server.GetInstantiationProgress(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "workflow_id")
}

func TestCancelInstantiation_Success(t *testing.T) {
	mockTemporal := new(MockTemporalClient)
	mockTemporal.On("CancelWorkflow", mock.Anything, "workflow-123").
		Return(nil)

	server := NewTemplateServer(mockTemporal, nil)

	req := &templatev1.CancelRequest{
		WorkflowId: "workflow-123",
	}

	resp, err := server.CancelInstantiation(context.Background(), req)

	assert.NoError(t, err)
	assert.NotNil(t, resp)
	assert.True(t, resp.Success)
	mockTemporal.AssertExpectations(t)
}

func TestCancelInstantiation_MissingWorkflowID(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.CancelRequest{}

	resp, err := server.CancelInstantiation(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "workflow_id")
}

func TestListAvailableOrgs_Success(t *testing.T) {
	mockPayload := new(MockPayloadClient)
	mockPayload.On("ListWorkspaceInstallations", mock.Anything, "workspace-1").
		Return([]*InstallationData{
			{OrgName: "org-1", AvatarURL: "https://example.com/avatar1.png", InstallationID: "inst-1"},
			{OrgName: "org-2", AvatarURL: "https://example.com/avatar2.png", InstallationID: "inst-2"},
		}, nil)

	server := NewTemplateServer(nil, mockPayload)

	req := &templatev1.ListAvailableOrgsRequest{
		WorkspaceId: "workspace-1",
	}

	resp, err := server.ListAvailableOrgs(context.Background(), req)

	assert.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Len(t, resp.Orgs, 2)
	assert.Equal(t, "org-1", resp.Orgs[0].Name)
	assert.Equal(t, "https://example.com/avatar1.png", resp.Orgs[0].AvatarUrl)
	assert.Equal(t, "inst-1", resp.Orgs[0].InstallationId)
	mockPayload.AssertExpectations(t)
}

func TestListAvailableOrgs_MissingWorkspaceID(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.ListAvailableOrgsRequest{}

	resp, err := server.ListAvailableOrgs(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
	assert.Contains(t, err.Error(), "workspace_id")
}
