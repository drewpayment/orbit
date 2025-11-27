package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type TemplateInstantiationWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *TemplateInstantiationWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()

	// Register stub activities for testing
	s.env.RegisterActivity(ValidateInstantiationInputActivity)
	s.env.RegisterActivity(CreateRepoFromTemplateActivity)
	s.env.RegisterActivity(CreateEmptyRepoActivity)
	s.env.RegisterActivity(CloneTemplateRepoActivity)
	s.env.RegisterActivity(ApplyTemplateVariablesActivity)
	s.env.RegisterActivity(PushToNewRepoActivity)
	s.env.RegisterActivity(CleanupWorkDirActivity)
	s.env.RegisterActivity(FinalizeInstantiationActivity)
}

func (s *TemplateInstantiationWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_GitHubTemplate_Success() {
	input := TemplateInstantiationInput{
		TemplateID:        "template-123",
		WorkspaceID:       "workspace-456",
		TargetOrg:         "my-org",
		RepositoryName:    "new-service",
		Description:       "A new service",
		IsPrivate:         true,
		IsGitHubTemplate:  true,
		SourceRepoOwner:   "template-org",
		SourceRepoName:    "service-template",
		Variables:         map[string]string{"service_name": "new-service"},
		UserID:            "user-789",
	}

	// Mock activities
	s.env.OnActivity(ValidateInstantiationInputActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(CreateRepoFromTemplateActivity, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	s.env.OnActivity(FinalizeInstantiationActivity, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("completed", result.Status)
	s.Equal("https://github.com/my-org/new-service", result.RepoURL)
}

func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_CloneFallback_Success() {
	input := TemplateInstantiationInput{
		TemplateID:        "template-123",
		WorkspaceID:       "workspace-456",
		TargetOrg:         "my-org",
		RepositoryName:    "new-service",
		Description:       "A new service",
		IsPrivate:         true,
		IsGitHubTemplate:  false, // Not a GitHub template
		SourceRepoOwner:   "template-org",
		SourceRepoName:    "service-template",
		SourceRepoURL:     "https://github.com/template-org/service-template",
		Variables:         map[string]string{"service_name": "new-service"},
		UserID:            "user-789",
	}

	// Mock activities for clone fallback path
	s.env.OnActivity(ValidateInstantiationInputActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(CreateEmptyRepoActivity, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	s.env.OnActivity(CloneTemplateRepoActivity, mock.Anything, mock.Anything).Return("/tmp/work/new-service", nil)
	s.env.OnActivity(ApplyTemplateVariablesActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(PushToNewRepoActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(CleanupWorkDirActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(FinalizeInstantiationActivity, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("completed", result.Status)
}

func TestTemplateInstantiationWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(TemplateInstantiationWorkflowTestSuite))
}
