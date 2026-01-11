// temporal-workflows/internal/workflows/lineage_aggregation_workflow.go
package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// LineageProcessingTaskQueue is the task queue for lineage processing workflows
	LineageProcessingTaskQueue = "lineage-processing"
)

// ActivityProcessingWorkflowInput is the input for processing a batch of activity records
type ActivityProcessingWorkflowInput struct {
	Records []activities.ClientActivityRecord `json:"records"`
}

// ActivityProcessingWorkflowResult is the result of processing activity records
type ActivityProcessingWorkflowResult struct {
	ProcessedCount int `json:"processedCount"`
	FailedCount    int `json:"failedCount"`
	NewEdgesCount  int `json:"newEdgesCount"`
}

// ActivityProcessingWorkflow processes a batch of client activity records and updates lineage edges.
// This workflow is triggered by the BifrostCallbackService when it receives activity data from Bifrost.
func ActivityProcessingWorkflow(ctx workflow.Context, input ActivityProcessingWorkflowInput) (ActivityProcessingWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting activity processing workflow",
		"RecordCount", len(input.Records),
	)

	// Configure activity options with retry policy
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var lineageActivities *activities.LineageActivitiesImpl

	// Process the activity batch
	var output *activities.ProcessActivityBatchOutput
	err := workflow.ExecuteActivity(ctx, lineageActivities.ProcessActivityBatch, activities.ProcessActivityBatchInput{
		Records: input.Records,
	}).Get(ctx, &output)
	if err != nil {
		logger.Error("Failed to process activity batch", "Error", err)
		return ActivityProcessingWorkflowResult{}, err
	}

	logger.Info("Activity processing workflow completed",
		"ProcessedCount", output.ProcessedCount,
		"FailedCount", output.FailedCount,
		"NewEdgesCount", output.NewEdgesCount,
	)

	return ActivityProcessingWorkflowResult{
		ProcessedCount: output.ProcessedCount,
		FailedCount:    output.FailedCount,
		NewEdgesCount:  output.NewEdgesCount,
	}, nil
}

// LineageAggregationWorkflowInput is the input for the lineage aggregation workflow
type LineageAggregationWorkflowInput struct {
	// InactivityThresholdHours is the number of hours after which an edge is marked inactive
	InactivityThresholdHours int `json:"inactivityThresholdHours"`
	// CreateSnapshot indicates whether to create a daily snapshot
	CreateSnapshot bool `json:"createSnapshot"`
	// SnapshotDate is the date for the snapshot in YYYY-MM-DD format (optional, defaults to today)
	SnapshotDate string `json:"snapshotDate,omitempty"`
}

// LineageAggregationWorkflowResult is the result of the aggregation workflow
type LineageAggregationWorkflowResult struct {
	EdgesReset       int `json:"edgesReset"`
	EdgesMarkedInactive int `json:"edgesMarkedInactive"`
	SnapshotsCreated int `json:"snapshotsCreated"`
}

// LineageAggregationWorkflow is a scheduled workflow that performs periodic lineage maintenance:
// 1. Resets 24h rolling metrics for all edges
// 2. Marks edges as inactive if not seen within the threshold
// 3. Optionally creates daily lineage snapshots
//
// This workflow should be scheduled to run hourly or daily depending on requirements.
func LineageAggregationWorkflow(ctx workflow.Context, input LineageAggregationWorkflowInput) (LineageAggregationWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting lineage aggregation workflow",
		"InactivityThresholdHours", input.InactivityThresholdHours,
		"CreateSnapshot", input.CreateSnapshot,
	)

	// Set default inactivity threshold
	inactivityThreshold := input.InactivityThresholdHours
	if inactivityThreshold <= 0 {
		inactivityThreshold = 24 // Default: 24 hours
	}

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		HeartbeatTimeout:    time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var lineageActivities *activities.LineageActivitiesImpl
	result := LineageAggregationWorkflowResult{}

	// Step 1: Reset 24h metrics
	logger.Info("Step 1: Resetting 24h metrics for all edges")
	var resetOutput *activities.ResetStale24hMetricsOutput
	err := workflow.ExecuteActivity(ctx, lineageActivities.ResetStale24hMetrics, activities.ResetStale24hMetricsInput{}).Get(ctx, &resetOutput)
	if err != nil {
		logger.Error("Failed to reset 24h metrics", "Error", err)
		return result, err
	}
	result.EdgesReset = resetOutput.EdgesReset
	logger.Info("Reset 24h metrics", "EdgesReset", result.EdgesReset)

	// Step 2: Mark inactive edges
	logger.Info("Step 2: Marking inactive edges",
		"ThresholdHours", inactivityThreshold,
	)
	var markOutput *activities.MarkInactiveEdgesOutput
	err = workflow.ExecuteActivity(ctx, lineageActivities.MarkInactiveEdges, activities.MarkInactiveEdgesInput{
		HoursThreshold: inactivityThreshold,
	}).Get(ctx, &markOutput)
	if err != nil {
		logger.Error("Failed to mark inactive edges", "Error", err)
		return result, err
	}
	result.EdgesMarkedInactive = markOutput.EdgesMarked
	logger.Info("Marked inactive edges", "EdgesMarked", result.EdgesMarkedInactive)

	// Step 3: Create daily snapshots (optional)
	if input.CreateSnapshot {
		snapshotDate := input.SnapshotDate
		if snapshotDate == "" {
			// Use workflow start time for deterministic date
			snapshotDate = workflow.Now(ctx).Format("2006-01-02")
		}
		logger.Info("Step 3: Creating daily snapshots", "Date", snapshotDate)

		var snapshotOutput *activities.CreateDailySnapshotsOutput
		err = workflow.ExecuteActivity(ctx, lineageActivities.CreateDailySnapshots, activities.CreateDailySnapshotsInput{
			Date: snapshotDate,
		}).Get(ctx, &snapshotOutput)
		if err != nil {
			logger.Error("Failed to create daily snapshots", "Error", err)
			return result, err
		}
		result.SnapshotsCreated = snapshotOutput.SnapshotsCreated
		logger.Info("Created daily snapshots", "SnapshotsCreated", result.SnapshotsCreated)
	}

	logger.Info("Lineage aggregation workflow completed",
		"EdgesReset", result.EdgesReset,
		"EdgesMarkedInactive", result.EdgesMarkedInactive,
		"SnapshotsCreated", result.SnapshotsCreated,
	)

	return result, nil
}

// ScheduledLineageMaintenanceWorkflow is a long-running workflow that continuously
// performs lineage maintenance on a schedule. It uses ContinueAsNew to prevent
// history from growing too large.
func ScheduledLineageMaintenanceWorkflow(ctx workflow.Context) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting scheduled lineage maintenance workflow")

	// Run aggregation every hour
	for i := 0; i < 24; i++ { // Run for 24 hours then continue-as-new
		// Sleep until the next hour boundary
		err := workflow.Sleep(ctx, time.Hour)
		if err != nil {
			return err
		}

		// Determine if we should create snapshots (once per day at midnight-ish)
		currentTime := workflow.Now(ctx)
		createSnapshot := currentTime.Hour() == 0

		// Run aggregation as a child workflow
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:         "lineage-aggregation-" + currentTime.Format("2006-01-02-15"),
			TaskQueue:          LineageProcessingTaskQueue,
			WorkflowRunTimeout: 30 * time.Minute,
		})

		var result LineageAggregationWorkflowResult
		err = workflow.ExecuteChildWorkflow(childCtx, LineageAggregationWorkflow, LineageAggregationWorkflowInput{
			InactivityThresholdHours: 24,
			CreateSnapshot:           createSnapshot,
		}).Get(childCtx, &result)
		if err != nil {
			logger.Error("Aggregation child workflow failed", "Error", err, "Iteration", i)
			// Continue to next iteration despite failure
		} else {
			logger.Info("Aggregation completed",
				"Iteration", i,
				"EdgesReset", result.EdgesReset,
				"EdgesMarkedInactive", result.EdgesMarkedInactive,
				"SnapshotsCreated", result.SnapshotsCreated,
			)
		}
	}

	// Continue as new to prevent workflow history from growing too large
	logger.Info("Continuing as new after 24 iterations")
	return workflow.NewContinueAsNewError(ctx, ScheduledLineageMaintenanceWorkflow)
}
