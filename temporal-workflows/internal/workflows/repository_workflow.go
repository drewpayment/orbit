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
)

// RepositoryWorkflowInput defines the input parameters for the repository creation workflow
type RepositoryWorkflowInput struct {
	WorkspaceID  string
	RepositoryID string
	TemplateName string
	Variables    map[string]string
	GitURL       string
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

	// Step 4: Push to remote repository
	logger.Info("Step 4: Pushing to remote repository")
	pushInput := activities.PushToRemoteInput{
		RepositoryID: input.RepositoryID,
	}
	err = workflow.ExecuteActivity(ctx, pushToRemoteActivityStub, pushInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to push to remote repository", "Error", err)
		return RepositoryWorkflowResult{
			RepositoryID: input.RepositoryID,
			Status:       "failed",
		}, err
	}

	logger.Info("Repository creation workflow completed successfully")
	return RepositoryWorkflowResult{
		RepositoryID: input.RepositoryID,
		GitURL:       input.GitURL,
		Status:       "completed",
	}, nil
}
