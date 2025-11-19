package workflows

import (
	"context"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Activity function stubs - these will be replaced with actual implementations when registering with worker
var (
	cloneTemplateActivityStub = func(ctx context.Context, input activities.CloneTemplateInput) error {
		panic("cloneTemplateActivityStub not implemented - register actual activity implementation")
	}
	applyVariablesActivityStub = func(ctx context.Context, input activities.ApplyVariablesInput) error {
		panic("applyVariablesActivityStub not implemented - register actual activity implementation")
	}
	initializeGitActivityStub = func(ctx context.Context, input activities.InitializeGitInput) error {
		panic("initializeGitActivityStub not implemented - register actual activity implementation")
	}
	pushToRemoteActivityStub = func(ctx context.Context, input activities.PushToRemoteInput) error {
		panic("pushToRemoteActivityStub not implemented - register actual activity implementation")
	}
	prepareGitHubRemoteActivityStub = func(ctx context.Context, input activities.PrepareGitHubRemoteInput) (*activities.PrepareGitHubRemoteOutput, error) {
		panic("prepareGitHubRemoteActivityStub not implemented - register actual activity implementation")
	}
)

// RepositoryWorkflowInput defines the input parameters for the repository creation workflow
type RepositoryWorkflowInput struct {
	WorkspaceID          string            // REQUIRED - for GitHub installation lookup
	RepositoryID         string
	GitHubInstallationID string            // OPTIONAL - override default installation
	TemplateName         string
	Variables            map[string]string
	GitURL               string            // OPTIONAL - if empty, create repo in GitHub
	RepositoryName       string            // REQUIRED if creating repo (GitURL empty)
}

// RepositoryWorkflowResult defines the output of the repository creation workflow
type RepositoryWorkflowResult struct {
	RepositoryID string
	GitURL       string
	Status       string
}

// RepositoryWorkflow orchestrates the creation of a repository from a template
func RepositoryWorkflow(ctx workflow.Context, input RepositoryWorkflowInput) (RepositoryWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting repository creation workflow",
		"WorkspaceID", input.WorkspaceID,
		"RepositoryID", input.RepositoryID,
		"TemplateName", input.TemplateName,
	)

	// Configure activity options with retry policy
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Clone template repository
	logger.Info("Step 1: Cloning template repository", "Template", input.TemplateName)
	cloneInput := activities.CloneTemplateInput{
		TemplateName: input.TemplateName,
		RepositoryID: input.RepositoryID,
	}
	err := workflow.ExecuteActivity(ctx, cloneTemplateActivityStub, cloneInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to clone template", "Error", err)
		return RepositoryWorkflowResult{
			RepositoryID: input.RepositoryID,
			Status:       "failed",
		}, err
	}

	// Step 2: Apply template variables
	logger.Info("Step 2: Applying template variables", "VariableCount", len(input.Variables))
	applyInput := activities.ApplyVariablesInput{
		RepositoryID: input.RepositoryID,
		Variables:    input.Variables,
	}
	err = workflow.ExecuteActivity(ctx, applyVariablesActivityStub, applyInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to apply template variables", "Error", err)
		return RepositoryWorkflowResult{
			RepositoryID: input.RepositoryID,
			Status:       "failed",
		}, err
	}

	// Step 3: Initialize Git repository
	logger.Info("Step 3: Initializing Git repository", "GitURL", input.GitURL)
	initInput := activities.InitializeGitInput{
		RepositoryID: input.RepositoryID,
		GitURL:       input.GitURL,
	}
	err = workflow.ExecuteActivity(ctx, initializeGitActivityStub, initInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to initialize Git repository", "Error", err)
		return RepositoryWorkflowResult{
			RepositoryID: input.RepositoryID,
			Status:       "failed",
		}, err
	}

	// Step 4: Prepare GitHub remote (NEW)
	logger.Info("Step 4: Preparing GitHub remote")
	var remoteOutput *activities.PrepareGitHubRemoteOutput
	prepareInput := activities.PrepareGitHubRemoteInput{
		WorkspaceID:          input.WorkspaceID,
		GitHubInstallationID: input.GitHubInstallationID,
		GitURL:               input.GitURL,
		RepositoryName:       input.RepositoryName,
		Private:              true, // Default to private repos
	}
	err = workflow.ExecuteActivity(ctx, prepareGitHubRemoteActivityStub, prepareInput).Get(ctx, &remoteOutput)
	if err != nil {
		logger.Error("Failed to prepare GitHub remote", "Error", err)
		return RepositoryWorkflowResult{
			RepositoryID: input.RepositoryID,
			Status:       "failed",
		}, err
	}

	// Step 5: Push to remote repository (UPDATED - use credentials from PrepareGitHubRemoteActivity)
	logger.Info("Step 5: Pushing to remote repository", "GitURL", remoteOutput.GitURL)
	pushInput := activities.PushToRemoteInput{
		RepositoryID: input.RepositoryID,
		GitURL:       remoteOutput.GitURL,
		AccessToken:  remoteOutput.AccessToken,
	}
	err = workflow.ExecuteActivity(ctx, pushToRemoteActivityStub, pushInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to push to remote repository", "Error", err)
		return RepositoryWorkflowResult{
			RepositoryID: input.RepositoryID,
			Status:       "failed",
		}, err
	}

	logger.Info("Repository creation workflow completed successfully",
		"RepositoryID", input.RepositoryID,
		"GitURL", remoteOutput.GitURL,
		"CreatedRepo", remoteOutput.CreatedRepo,
	)
	return RepositoryWorkflowResult{
		RepositoryID: input.RepositoryID,
		GitURL:       remoteOutput.GitURL,
		Status:       "completed",
	}, nil
}
