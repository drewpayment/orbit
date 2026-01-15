package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// Activity names for health check workflow
const (
	ActivityPerformHealthCheck = "PerformHealthCheckActivity"
	ActivityRecordHealthResult = "RecordHealthResultActivity"
)

// HealthCheckWorkflow is a long-running workflow that performs periodic health checks.
// It uses ContinueAsNew to prevent unbounded history growth.
func HealthCheckWorkflow(ctx workflow.Context, input HealthCheckWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting health check workflow",
		"appId", input.AppID,
		"url", input.HealthConfig.URL,
		"checksPerformed", input.ChecksPerformed)

	// Initialize state for this workflow run
	checksPerformed := input.ChecksPerformed
	var lastResult *HealthCheckResult
	if input.LastResult != nil {
		lastResult = input.LastResult
	}
	var lastCheckedAt time.Time

	// Register query handler for current health status
	err := workflow.SetQueryHandler(ctx, QueryHealthStatus, func() (HealthStatusQueryResult, error) {
		status := "pending"
		var statusCode int
		var responseTime int64
		var errorMsg string

		if lastResult != nil {
			status = lastResult.Status
			statusCode = lastResult.StatusCode
			responseTime = lastResult.ResponseTime
			errorMsg = lastResult.Error
		}

		return HealthStatusQueryResult{
			Status:          status,
			StatusCode:      statusCode,
			ResponseTime:    responseTime,
			Error:           errorMsg,
			ChecksPerformed: checksPerformed,
			LastCheckedAt:   lastCheckedAt.Format(time.RFC3339),
		}, nil
	})
	if err != nil {
		logger.Error("Failed to register query handler", "error", err)
		return err
	}

	// Activity options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    2,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Calculate interval (enforce minimum)
	interval := input.HealthConfig.Interval
	if interval < MinHealthCheckInterval {
		interval = MinHealthCheckInterval
	}

	// Main loop - perform health checks at the configured interval
	for {
		// Perform health check
		var result activities.HealthCheckResult
		err := workflow.ExecuteActivity(ctx, ActivityPerformHealthCheck, activities.PerformHealthCheckInput{
			URL:            input.HealthConfig.URL,
			Method:         input.HealthConfig.Method,
			ExpectedStatus: input.HealthConfig.ExpectedStatus,
			Timeout:        input.HealthConfig.Timeout,
		}).Get(ctx, &result)

		if err != nil {
			logger.Error("Health check activity failed", "error", err)
			result = activities.HealthCheckResult{
				Status: "down",
				Error:  err.Error(),
			}
		}

		// Update local state for query
		lastResult = &HealthCheckResult{
			Status:       result.Status,
			StatusCode:   result.StatusCode,
			ResponseTime: result.ResponseTime,
			Error:        result.Error,
		}
		lastCheckedAt = workflow.Now(ctx)
		checksPerformed++

		// Record result (fire and forget - don't fail workflow if recording fails)
		recordCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
			},
		})

		err = workflow.ExecuteActivity(recordCtx, ActivityRecordHealthResult, activities.RecordHealthResultInput{
			AppID:  input.AppID,
			Result: result,
		}).Get(ctx, nil)

		if err != nil {
			logger.Error("Failed to record health result", "error", err)
		}

		logger.Info("Health check completed",
			"appId", input.AppID,
			"status", result.Status,
			"checksPerformed", checksPerformed)

		// Check if we need to ContinueAsNew to prevent history bloat
		if checksPerformed >= MaxChecksBeforeContinueAsNew {
			logger.Info("Triggering ContinueAsNew", "checksPerformed", checksPerformed)
			return workflow.NewContinueAsNewError(ctx, HealthCheckWorkflow, HealthCheckWorkflowInput{
				AppID:           input.AppID,
				HealthConfig:    input.HealthConfig,
				ChecksPerformed: 0, // Reset counter
				LastResult:      lastResult, // Preserve last result for query continuity
			})
		}

		// Sleep until next check
		if err := workflow.Sleep(ctx, time.Duration(interval)*time.Second); err != nil {
			// Context cancelled - workflow is being terminated
			logger.Info("Workflow cancelled during sleep", "appId", input.AppID)
			return err
		}
	}
}
