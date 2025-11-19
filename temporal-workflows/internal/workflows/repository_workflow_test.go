package workflows

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type RepositoryWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *RepositoryWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()

	// Register stub activities for testing
	s.env.RegisterActivity(cloneTemplateActivityStub)
	s.env.RegisterActivity(applyVariablesActivityStub)
	s.env.RegisterActivity(initializeGitActivityStub)
	s.env.RegisterActivity(prepareGitHubRemoteActivityStub)
	s.env.RegisterActivity(pushToRemoteActivityStub)
}

func (s *RepositoryWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func TestRepositoryWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(RepositoryWorkflowTestSuite))
}

// Test successful repository creation workflow
func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_Success() {
	input := RepositoryWorkflowInput{
		WorkspaceID:  "workspace-123",
		RepositoryID: "repo-456",
		TemplateName: "go-microservice",
		Variables: map[string]string{
			"service_name": "my-service",
			"description":  "My Go Microservice",
		},
		GitURL: "https://github.com/test/my-service.git",
	}

	// Mock CloneTemplateActivity
	s.env.OnActivity(cloneTemplateActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock ApplyVariablesActivity
	s.env.OnActivity(applyVariablesActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock InitializeGitActivity
	s.env.OnActivity(initializeGitActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock PrepareGitHubRemoteActivity
	s.env.OnActivity(prepareGitHubRemoteActivityStub, mock.Anything, mock.Anything).Return(
		&activities.PrepareGitHubRemoteOutput{
			GitURL:              input.GitURL,
			AccessToken:         "test-token",
			InstallationOrgName: "test-org",
			CreatedRepo:         false,
		}, nil,
	)

	// Mock PushToRemoteActivity
	s.env.OnActivity(pushToRemoteActivityStub, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(RepositoryWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result RepositoryWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("repo-456", result.RepositoryID)
	s.Equal("https://github.com/test/my-service.git", result.GitURL)
	s.Equal("completed", result.Status)
}

// Test workflow failure when template is not found
func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_TemplateNotFound() {
	input := RepositoryWorkflowInput{
		WorkspaceID:  "workspace-123",
		RepositoryID: "repo-456",
		TemplateName: "non-existent-template",
		Variables:    map[string]string{},
		GitURL:       "https://github.com/test/my-service.git",
	}

	// Mock CloneTemplateActivity to return an error
	s.env.OnActivity(cloneTemplateActivityStub, mock.Anything, mock.Anything).
		Return(errors.New("template not found"))

	s.env.ExecuteWorkflow(RepositoryWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test workflow failure when Git push fails
func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_GitPushFailed() {
	input := RepositoryWorkflowInput{
		WorkspaceID:  "workspace-123",
		RepositoryID: "repo-456",
		TemplateName: "go-microservice",
		Variables:    map[string]string{},
		GitURL:       "https://github.com/test/my-service.git",
	}

	// Mock successful activities until PushToRemoteActivity
	s.env.OnActivity(cloneTemplateActivityStub, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(applyVariablesActivityStub, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(initializeGitActivityStub, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(prepareGitHubRemoteActivityStub, mock.Anything, mock.Anything).Return(
		&activities.PrepareGitHubRemoteOutput{
			GitURL:              input.GitURL,
			AccessToken:         "test-token",
			InstallationOrgName: "test-org",
			CreatedRepo:         false,
		}, nil,
	)
	s.env.OnActivity(pushToRemoteActivityStub, mock.Anything, mock.Anything).Return(errors.New("push failed"))

	s.env.ExecuteWorkflow(RepositoryWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test retry behavior
func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_RetryBehavior() {
	input := RepositoryWorkflowInput{
		WorkspaceID:  "workspace-123",
		RepositoryID: "repo-456",
		TemplateName: "go-microservice",
		Variables:    map[string]string{},
		GitURL:       "https://github.com/test/my-service.git",
	}

	// Mock CloneTemplateActivity to fail twice then succeed
	callCount := 0
	s.env.OnActivity(cloneTemplateActivityStub, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.CloneTemplateInput) error {
			callCount++
			if callCount < 3 {
				return errors.New("temporary failure")
			}
			return nil
		})

	// Mock other activities
	s.env.OnActivity(applyVariablesActivityStub, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(initializeGitActivityStub, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(prepareGitHubRemoteActivityStub, mock.Anything, mock.Anything).Return(
		&activities.PrepareGitHubRemoteOutput{
			GitURL:              input.GitURL,
			AccessToken:         "test-token",
			InstallationOrgName: "test-org",
			CreatedRepo:         false,
		}, nil,
	)
	s.env.OnActivity(pushToRemoteActivityStub, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(RepositoryWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result RepositoryWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("completed", result.Status)
}

// Test GitHub App integration workflow
func (s *RepositoryWorkflowTestSuite) TestRepositoryWorkflow_WithGitHubAppIntegration() {
	input := RepositoryWorkflowInput{
		WorkspaceID:    "workspace-123",
		RepositoryID:   "repo-123",
		TemplateName:   "microservice",
		RepositoryName: "new-repo",
		Variables: map[string]string{
			"service_name": "test",
		},
	}

	// Mock CloneTemplateActivity
	s.env.OnActivity(cloneTemplateActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock ApplyVariablesActivity
	s.env.OnActivity(applyVariablesActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock InitializeGitActivity
	s.env.OnActivity(initializeGitActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock PrepareGitHubRemoteActivity
	s.env.OnActivity(prepareGitHubRemoteActivityStub, mock.Anything, mock.Anything).Return(
		&activities.PrepareGitHubRemoteOutput{
			GitURL:              "https://github.com/test-org/new-repo.git",
			AccessToken:         "token123",
			InstallationOrgName: "test-org",
			CreatedRepo:         true,
		}, nil,
	)

	// Mock PushToRemoteActivity
	s.env.OnActivity(pushToRemoteActivityStub, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(RepositoryWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result RepositoryWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("repo-123", result.RepositoryID)
	s.Equal("completed", result.Status)
}
