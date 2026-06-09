package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// GitHubReconcileResult mirrors the activity result so the workflow can log it.
type GitHubReconcileResult struct {
	Checked  int
	Started  int
	Signaled int
	Failed   int
}

// GitHubInstallationReconcileWorkflow is a thin, short-lived workflow run by a
// Temporal Schedule. It asks orbit-www to ensure a refresh workflow is running
// for every active installation — the backstop that guarantees no installation
// is ever orphaned by a missed webhook or a worker restart.
func GitHubInstallationReconcileWorkflow(ctx workflow.Context) (GitHubReconcileResult, error) {
	logger := workflow.GetLogger(ctx)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var result GitHubReconcileResult
	if err := workflow.ExecuteActivity(ctx, "ReconcileGitHubInstallationsActivity").Get(ctx, &result); err != nil {
		logger.Error("GitHub installation reconcile failed", "error", err)
		return GitHubReconcileResult{}, err
	}

	logger.Info("GitHub installation reconcile complete",
		"checked", result.Checked,
		"started", result.Started,
		"signaled", result.Signaled,
		"failed", result.Failed)
	return result, nil
}
