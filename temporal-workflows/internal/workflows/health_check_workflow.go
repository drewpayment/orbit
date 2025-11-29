package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// HealthCheckWorkflow performs a single health check and records the result
// This workflow is triggered by a Temporal Schedule at the configured interval
func HealthCheckWorkflow(ctx workflow.Context, input HealthCheckWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting health check workflow", "appId", input.AppID, "url", input.HealthConfig.URL)

	// Activity options with short timeout since health checks should be quick
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    2, // Limited retries - schedule will trigger again
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Perform health check
	var result activities.HealthCheckResult
	err := workflow.ExecuteActivity(ctx, (*activities.HealthCheckActivities).PerformHealthCheckActivity, activities.PerformHealthCheckInput{
		URL:            input.HealthConfig.URL,
		Method:         input.HealthConfig.Method,
		ExpectedStatus: input.HealthConfig.ExpectedStatus,
		Timeout:        input.HealthConfig.Timeout,
	}).Get(ctx, &result)

	if err != nil {
		logger.Error("Health check activity failed", "error", err)
		// Record as down
		result = activities.HealthCheckResult{
			Status: "down",
			Error:  err.Error(),
		}
	}

	// Record result (fire and forget - don't fail workflow if recording fails)
	recordCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	})

	err = workflow.ExecuteActivity(recordCtx, (*activities.HealthCheckActivities).RecordHealthResultActivity, activities.RecordHealthResultInput{
		AppID:  input.AppID,
		Result: result,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to record health result", "error", err)
		// Don't return error - the check itself succeeded
	}

	logger.Info("Health check completed", "appId", input.AppID, "status", result.Status)
	return nil
}
