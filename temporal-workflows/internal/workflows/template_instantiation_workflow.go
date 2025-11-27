package workflows

import (
	"context"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// TemplateInstantiationInput contains all parameters needed for template instantiation
type TemplateInstantiationInput struct {
	TemplateID       string            // ID of the template being instantiated
	WorkspaceID      string            // Workspace where repo will be created
	TargetOrg        string            // GitHub org/user for the new repo
	RepositoryName   string            // Name for the new repository
	Description      string            // Description for the new repository
	IsPrivate        bool              // Whether the repo should be private
	IsGitHubTemplate bool              // True if template repo has GitHub template enabled
	SourceRepoOwner  string            // Owner of the source template repo
	SourceRepoName   string            // Name of the source template repo
	SourceRepoURL    string            // Full URL of source repo (for non-GitHub templates)
	Variables        map[string]string // Template variables to substitute
	UserID           string            // ID of user initiating instantiation
}

// TemplateInstantiationResult contains the workflow result
type TemplateInstantiationResult struct {
	Status   string // "completed", "failed"
	RepoURL  string // URL of the created repository
	RepoName string // Name of the created repository
	Error    string // Error message if failed
}

// InstantiationProgress tracks workflow progress for query handler
type InstantiationProgress struct {
	CurrentStep  string
	StepsTotal   int
	StepsCurrent int
	Message      string
}

// CreateRepoResult contains information about a created repository
type CreateRepoResult struct {
	RepoURL  string
	RepoName string
}

// Activity input/output types
type ValidateInstantiationInputActivityInput struct {
	Input TemplateInstantiationInput
}

type CreateRepoFromTemplateActivityInput struct {
	Input TemplateInstantiationInput
}

type CreateEmptyRepoActivityInput struct {
	Input TemplateInstantiationInput
}

type CloneTemplateRepoActivityInput struct {
	Input TemplateInstantiationInput
}

type ApplyTemplateVariablesActivityInput struct {
	WorkDir   string
	Variables map[string]string
}

type PushToNewRepoActivityInput struct {
	WorkDir string
	RepoURL string
}

type CleanupWorkDirActivityInput struct {
	WorkDir string
}

type FinalizeInstantiationActivityInput struct {
	TemplateID  string
	WorkspaceID string
	RepoURL     string
	RepoName    string
	UserID      string
}

// Activity function stubs - these will be replaced with actual implementations when registering with worker
var (
	ValidateInstantiationInputActivity = func(ctx context.Context, input TemplateInstantiationInput) error {
		panic("ValidateInstantiationInputActivity not implemented - register actual activity implementation")
	}
	CreateRepoFromTemplateActivity = func(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
		panic("CreateRepoFromTemplateActivity not implemented - register actual activity implementation")
	}
	CreateEmptyRepoActivity = func(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
		panic("CreateEmptyRepoActivity not implemented - register actual activity implementation")
	}
	CloneTemplateRepoActivity = func(ctx context.Context, input TemplateInstantiationInput) (string, error) {
		panic("CloneTemplateRepoActivity not implemented - register actual activity implementation")
	}
	ApplyTemplateVariablesActivity = func(ctx context.Context, input ApplyTemplateVariablesActivityInput) error {
		panic("ApplyTemplateVariablesActivity not implemented - register actual activity implementation")
	}
	PushToNewRepoActivity = func(ctx context.Context, input PushToNewRepoActivityInput) error {
		panic("PushToNewRepoActivity not implemented - register actual activity implementation")
	}
	CleanupWorkDirActivity = func(ctx context.Context, workDir string) error {
		panic("CleanupWorkDirActivity not implemented - register actual activity implementation")
	}
	FinalizeInstantiationActivity = func(ctx context.Context, input FinalizeInstantiationActivityInput) error {
		panic("FinalizeInstantiationActivity not implemented - register actual activity implementation")
	}
)

// TemplateInstantiationWorkflow orchestrates repository creation from templates
func TemplateInstantiationWorkflow(ctx workflow.Context, input TemplateInstantiationInput) (*TemplateInstantiationResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting template instantiation workflow",
		"templateID", input.TemplateID,
		"repoName", input.RepositoryName,
		"isGitHubTemplate", input.IsGitHubTemplate)

	// Progress tracking
	progress := InstantiationProgress{
		CurrentStep:  "initializing",
		StepsTotal:   5,
		StepsCurrent: 0,
		Message:      "Starting template instantiation",
	}

	// Set up query handler for progress tracking
	err := workflow.SetQueryHandler(ctx, "progress", func() (InstantiationProgress, error) {
		return progress, nil
	})
	if err != nil {
		logger.Error("Failed to set query handler", "error", err)
		return &TemplateInstantiationResult{
			Status: "failed",
			Error:  "failed to set up progress tracking: " + err.Error(),
		}, err
	}

	// Activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Validate input
	progress.CurrentStep = "validating input"
	progress.StepsCurrent = 1
	progress.Message = "Validating template instantiation parameters"

	err = workflow.ExecuteActivity(ctx, ValidateInstantiationInputActivity, input).Get(ctx, nil)
	if err != nil {
		logger.Error("Input validation failed", "error", err)
		return &TemplateInstantiationResult{
			Status: "failed",
			Error:  "input validation failed: " + err.Error(),
		}, err
	}

	var repoResult *CreateRepoResult

	// Branch based on whether this is a GitHub template
	if input.IsGitHubTemplate {
		// GitHub Template API path (faster)
		progress.CurrentStep = "creating from template"
		progress.StepsCurrent = 2
		progress.Message = "Creating repository from GitHub template"

		err = workflow.ExecuteActivity(ctx, CreateRepoFromTemplateActivity, input).Get(ctx, &repoResult)
		if err != nil {
			logger.Error("Failed to create repo from template", "error", err)
			return &TemplateInstantiationResult{
				Status: "failed",
				Error:  "failed to create repository from template: " + err.Error(),
			}, err
		}

		progress.StepsCurrent = 5 // Skip clone/push steps
	} else {
		// Clone fallback path (for non-template repos)
		progress.CurrentStep = "creating empty repository"
		progress.StepsCurrent = 2
		progress.Message = "Creating empty repository"

		// Step 2: Create empty repository
		err = workflow.ExecuteActivity(ctx, CreateEmptyRepoActivity, input).Get(ctx, &repoResult)
		if err != nil {
			logger.Error("Failed to create empty repo", "error", err)
			return &TemplateInstantiationResult{
				Status: "failed",
				Error:  "failed to create empty repository: " + err.Error(),
			}, err
		}

		// Step 3: Clone template repository
		progress.CurrentStep = "cloning template"
		progress.StepsCurrent = 3
		progress.Message = "Cloning template repository"

		var workDir string
		err = workflow.ExecuteActivity(ctx, CloneTemplateRepoActivity, input).Get(ctx, &workDir)
		if err != nil {
			logger.Error("Failed to clone template", "error", err)
			return &TemplateInstantiationResult{
				Status: "failed",
				Error:  "failed to clone template repository: " + err.Error(),
			}, err
		}

		// Step 4: Apply template variables
		progress.CurrentStep = "applying variables"
		progress.StepsCurrent = 4
		progress.Message = "Applying template variables"

		applyInput := ApplyTemplateVariablesActivityInput{
			WorkDir:   workDir,
			Variables: input.Variables,
		}
		err = workflow.ExecuteActivity(ctx, ApplyTemplateVariablesActivity, applyInput).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to apply variables", "error", err)
			// Clean up work directory
			_ = workflow.ExecuteActivity(ctx, CleanupWorkDirActivity, workDir).Get(ctx, nil)
			return &TemplateInstantiationResult{
				Status: "failed",
				Error:  "failed to apply template variables: " + err.Error(),
			}, err
		}

		// Step 5: Push to new repository
		progress.CurrentStep = "pushing to repository"
		progress.StepsCurrent = 5
		progress.Message = "Pushing code to new repository"

		pushInput := PushToNewRepoActivityInput{
			WorkDir: workDir,
			RepoURL: repoResult.RepoURL,
		}
		err = workflow.ExecuteActivity(ctx, PushToNewRepoActivity, pushInput).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to push to repo", "error", err)
			// Clean up work directory
			_ = workflow.ExecuteActivity(ctx, CleanupWorkDirActivity, workDir).Get(ctx, nil)
			return &TemplateInstantiationResult{
				Status: "failed",
				Error:  "failed to push to new repository: " + err.Error(),
			}, err
		}

		// Clean up work directory
		_ = workflow.ExecuteActivity(ctx, CleanupWorkDirActivity, workDir).Get(ctx, nil)
	}

	// Final step: Finalize instantiation (record in database, send notifications, etc.)
	progress.CurrentStep = "finalizing"
	progress.Message = "Finalizing template instantiation"

	finalizeInput := FinalizeInstantiationActivityInput{
		TemplateID:  input.TemplateID,
		WorkspaceID: input.WorkspaceID,
		RepoURL:     repoResult.RepoURL,
		RepoName:    repoResult.RepoName,
		UserID:      input.UserID,
	}
	err = workflow.ExecuteActivity(ctx, FinalizeInstantiationActivity, finalizeInput).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to finalize instantiation", "error", err)
		return &TemplateInstantiationResult{
			Status: "failed",
			Error:  "failed to finalize instantiation: " + err.Error(),
		}, err
	}

	progress.CurrentStep = "completed"
	progress.Message = "Template instantiation completed successfully"

	logger.Info("Template instantiation workflow completed",
		"repoURL", repoResult.RepoURL,
		"repoName", repoResult.RepoName)

	return &TemplateInstantiationResult{
		Status:   "completed",
		RepoURL:  repoResult.RepoURL,
		RepoName: repoResult.RepoName,
	}, nil
}
