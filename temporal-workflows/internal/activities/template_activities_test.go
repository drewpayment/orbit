package activities

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockGitHubClient for testing
type MockGitHubClient struct {
	mock.Mock
}

func (m *MockGitHubClient) CreateRepoFromTemplate(ctx context.Context, sourceOwner, sourceRepo, targetOrg, targetName, description string, private bool) (string, error) {
	args := m.Called(ctx, sourceOwner, sourceRepo, targetOrg, targetName, description, private)
	return args.String(0), args.Error(1)
}

func (m *MockGitHubClient) CreateRepository(ctx context.Context, org, name, description string, private bool) (string, error) {
	args := m.Called(ctx, org, name, description, private)
	return args.String(0), args.Error(1)
}

func TestValidateInstantiationInput_Success(t *testing.T) {
	activities := NewTemplateActivities(nil, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		TemplateID:       "template-123",
		WorkspaceID:      "workspace-456",
		TargetOrg:        "my-org",
		RepositoryName:   "new-service",
		IsGitHubTemplate: true,
		SourceRepoOwner:  "template-org",
		SourceRepoName:   "template-repo",
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.NoError(t, err)
}

func TestValidateInstantiationInput_MissingFields(t *testing.T) {
	activities := NewTemplateActivities(nil, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		TemplateID: "template-123",
		// Missing required fields
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "required")
}

func TestValidateInstantiationInput_InvalidRepoName(t *testing.T) {
	activities := NewTemplateActivities(nil, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		TemplateID:     "template-123",
		WorkspaceID:    "workspace-456",
		TargetOrg:      "my-org",
		RepositoryName: "invalid name with spaces",
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid repository name")
}

func TestCreateRepoFromTemplate_Success(t *testing.T) {
	mockClient := new(MockGitHubClient)
	mockClient.On("CreateRepoFromTemplate",
		mock.Anything,
		"template-org", "template-repo",
		"my-org", "new-service",
		"A new service", true,
	).Return("https://github.com/my-org/new-service", nil)

	activities := NewTemplateActivities(mockClient, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		SourceRepoOwner: "template-org",
		SourceRepoName:  "template-repo",
		TargetOrg:       "my-org",
		RepositoryName:  "new-service",
		Description:     "A new service",
		IsPrivate:       true,
	}

	result, err := activities.CreateRepoFromTemplate(context.Background(), input)
	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-service", result.RepoURL)
	assert.Equal(t, "new-service", result.RepoName)

	mockClient.AssertExpectations(t)
}

func TestCreateEmptyRepo_Success(t *testing.T) {
	mockClient := new(MockGitHubClient)
	mockClient.On("CreateRepository",
		mock.Anything,
		"my-org", "new-service",
		"A new service", true,
	).Return("https://github.com/my-org/new-service", nil)

	activities := NewTemplateActivities(mockClient, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		TargetOrg:      "my-org",
		RepositoryName: "new-service",
		Description:    "A new service",
		IsPrivate:      true,
	}

	result, err := activities.CreateEmptyRepo(context.Background(), input)
	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-service", result.RepoURL)

	mockClient.AssertExpectations(t)
}
