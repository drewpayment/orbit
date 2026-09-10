package workflows

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

// Stub activity functions for testing
func stubValidateInstantiationInput(ctx context.Context, input TemplateInstantiationInput) error {
	return nil
}

func stubCreateRepoFromTemplate(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
	return &CreateRepoResult{}, nil
}

func stubCreateEmptyRepo(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
	return &CreateRepoResult{}, nil
}

func stubCloneTemplateRepo(ctx context.Context, input TemplateInstantiationInput) (string, error) {
	return "", nil
}

func stubApplyTemplateVariables(ctx context.Context, input ApplyTemplateVariablesActivityInput) (*ApplyTemplateVariablesResult, error) {
	return &ApplyTemplateVariablesResult{}, nil
}

func stubPushToNewRepo(ctx context.Context, input PushToNewRepoActivityInput) error {
	return nil
}

func stubFinalizeInstantiation(ctx context.Context, input FinalizeInstantiationActivityInput) error {
	return nil
}

type TemplateInstantiationWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *TemplateInstantiationWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()

	// Register stub activities with names matching workflow constants
	s.env.RegisterActivityWithOptions(stubValidateInstantiationInput, activity.RegisterOptions{
		Name: ActivityValidateInstantiationInput,
	})
	s.env.RegisterActivityWithOptions(stubCreateRepoFromTemplate, activity.RegisterOptions{
		Name: ActivityCreateRepoFromTemplate,
	})
	s.env.RegisterActivityWithOptions(stubCreateEmptyRepo, activity.RegisterOptions{
		Name: ActivityCreateEmptyRepo,
	})
	s.env.RegisterActivityWithOptions(stubCloneTemplateRepo, activity.RegisterOptions{
		Name: ActivityCloneTemplateRepo,
	})
	s.env.RegisterActivityWithOptions(stubApplyTemplateVariables, activity.RegisterOptions{
		Name: ActivityApplyTemplateVariables,
	})
	s.env.RegisterActivityWithOptions(stubPushToNewRepo, activity.RegisterOptions{
		Name: ActivityPushToNewRepo,
	})
	s.env.RegisterActivityWithOptions(stubCleanupWorkDir, activity.RegisterOptions{
		Name: ActivityCleanupWorkDir,
	})
	s.env.RegisterActivityWithOptions(stubFinalizeInstantiation, activity.RegisterOptions{
		Name: ActivityFinalizeInstantiation,
	})
}

func (s *TemplateInstantiationWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_GitHubTemplate_Success() {
	input := TemplateInstantiationInput{
		TemplateID:       "template-123",
		WorkspaceID:      "workspace-456",
		TargetOrg:        "my-org",
		RepositoryName:   "new-service",
		Description:      "A new service",
		IsPrivate:        true,
		IsGitHubTemplate: true,
		SourceRepoOwner:  "template-org",
		SourceRepoName:   "service-template",
		Variables:        map[string]string{"service_name": "new-service"},
		UserID:           "user-789",
	}

	// Mock activities
	s.env.OnActivity(stubValidateInstantiationInput, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(stubCreateRepoFromTemplate, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	s.env.OnActivity(stubFinalizeInstantiation, mock.Anything, mock.Anything).Return(nil)

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
		TemplateID:       "template-123",
		WorkspaceID:      "workspace-456",
		TargetOrg:        "my-org",
		RepositoryName:   "new-service",
		Description:      "A new service",
		IsPrivate:        true,
		IsGitHubTemplate: false, // Not a GitHub template
		SourceRepoOwner:  "template-org",
		SourceRepoName:   "service-template",
		SourceRepoURL:    "https://github.com/template-org/service-template",
		Variables:        map[string]string{"service_name": "new-service"},
		UserID:           "user-789",
	}

	// Mock activities for clone fallback path
	s.env.OnActivity(stubValidateInstantiationInput, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(stubCreateEmptyRepo, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	s.env.OnActivity(stubCloneTemplateRepo, mock.Anything, mock.Anything).Return("/tmp/work/new-service", nil)
	s.env.OnActivity(stubApplyTemplateVariables, mock.Anything, mock.Anything).Return(&ApplyTemplateVariablesResult{}, nil)
	s.env.OnActivity(stubPushToNewRepo, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(stubCleanupWorkDir, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(stubFinalizeInstantiation, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("completed", result.Status)
}

// TestTemplateInstantiation_CancelDuringClone cancels the workflow while the
// clone-fallback path's CloneTemplateRepo activity is still in flight. The
// workflow must catch the resulting canceled error, run best-effort cleanup
// of the work directory on a disconnected context, and return a clean
// "cancelled" result instead of propagating the cancellation as a workflow
// error.
func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_CancelDuringClone() {
	input := TemplateInstantiationInput{
		TemplateID:       "template-123",
		WorkspaceID:      "workspace-456",
		TargetOrg:        "my-org",
		RepositoryName:   "new-service",
		Description:      "A new service",
		IsPrivate:        true,
		IsGitHubTemplate: false,
		SourceRepoOwner:  "template-org",
		SourceRepoName:   "service-template",
		SourceRepoURL:    "https://github.com/template-org/service-template",
		Variables:        map[string]string{"service_name": "new-service"},
		UserID:           "user-789",
	}

	s.env.OnActivity(stubValidateInstantiationInput, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(stubCreateEmptyRepo, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	// Never resolves within the test's cancellation window, simulating an
	// in-flight clone when the cancellation request arrives.
	s.env.OnActivity(stubCloneTemplateRepo, mock.Anything, mock.Anything).
		After(time.Minute).
		Return("/tmp/work/new-service", nil)

	cleanupCalled := false
	s.env.OnActivity(stubCleanupWorkDir, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, workDir string) error {
			cleanupCalled = true
			return nil
		})

	s.env.RegisterDelayedCallback(func() {
		s.env.CancelWorkflow()
	}, time.Second)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("cancelled", result.Status)
	s.True(cleanupCalled, "expected best-effort cleanup to run after cancellation")
}

// TestTemplateInstantiation_CancelBeforeAnyActivity cancels the workflow
// before the very first activity (input validation) resolves, so no work
// directory has ever been created. The workflow must still return a clean
// "cancelled" result without panicking on the empty work directory.
func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_CancelBeforeAnyActivity() {
	input := TemplateInstantiationInput{
		TemplateID:       "template-123",
		WorkspaceID:      "workspace-456",
		TargetOrg:        "my-org",
		RepositoryName:   "new-service",
		Description:      "A new service",
		IsPrivate:        true,
		IsGitHubTemplate: false,
		SourceRepoOwner:  "template-org",
		SourceRepoName:   "service-template",
		SourceRepoURL:    "https://github.com/template-org/service-template",
		Variables:        map[string]string{"service_name": "new-service"},
		UserID:           "user-789",
	}

	s.env.OnActivity(stubValidateInstantiationInput, mock.Anything, mock.Anything).
		After(time.Minute).
		Return(nil)

	s.env.RegisterDelayedCallback(func() {
		s.env.CancelWorkflow()
	}, time.Millisecond)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("cancelled", result.Status)
}

func TestTemplateInstantiationWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(TemplateInstantiationWorkflowTestSuite))
}
