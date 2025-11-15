package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

type GitHubTokenRefreshWorkflowInput struct {
	InstallationID string // Payload document ID (not GitHub installation ID)
}

type RefreshTokenResult struct {
	Success      bool
	ExpiresAt    time.Time
	ErrorMessage string
}

// GitHubTokenRefreshWorkflow continuously refreshes a GitHub App installation token
// This workflow runs indefinitely until cancelled (when app is uninstalled)
func GitHubTokenRefreshWorkflow(ctx workflow.Context, input GitHubTokenRefreshWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting GitHub token refresh workflow", "installationId", input.InstallationID)

	// Activity options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Refresh token immediately on workflow start
	var result RefreshTokenResult
	err := workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)
	if err != nil {
		logger.Error("Initial token refresh failed", "error", err)
		// Mark as refresh_failed but continue trying
		workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
	} else {
		logger.Info("Initial token refresh succeeded", "expiresAt", result.ExpiresAt)
	}

	// Run indefinitely until workflow is cancelled
	for {
		// Sleep for 50 minutes (10 min before token expires)
		err := workflow.Sleep(ctx, 50*time.Minute)
		if err != nil {
			// Workflow cancelled (app uninstalled)
			logger.Info("Workflow cancelled, stopping token refresh", "error", err)
			return err
		}

		// Refresh token
		var result RefreshTokenResult
		err = workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)

		if err != nil {
			logger.Error("Token refresh failed", "error", err)
			// Update status but continue trying
			workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
		} else {
			logger.Info("Token refresh succeeded", "expiresAt", result.ExpiresAt)
			// Update status to active
			workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "active", "")
		}
	}
}
