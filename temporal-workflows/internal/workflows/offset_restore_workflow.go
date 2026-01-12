// temporal-workflows/internal/workflows/offset_restore_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// OffsetRestoreTaskQueue is the task queue for offset restore workflows
	OffsetRestoreTaskQueue = "offset-restore"
)

// OffsetRestoreInput is the input for the offset restore workflow.
type OffsetRestoreInput struct {
	ConsumerGroupID string `json:"consumerGroupId"`
	CheckpointID    string `json:"checkpointId"`
	RequestedBy     string `json:"requestedBy,omitempty"`
}

// OffsetRestoreResult is the result of the offset restore workflow.
type OffsetRestoreResult struct {
	Success         bool   `json:"success"`
	PartitionsReset int    `json:"partitionsReset"`
	Error           string `json:"error,omitempty"`
}

// FetchCheckpointInput is the input for the FetchCheckpoint activity.
type FetchCheckpointInput struct {
	CheckpointID string `json:"checkpointId"`
}

// FetchCheckpointResult is the result of the FetchCheckpoint activity.
type FetchCheckpointResult struct {
	Offsets map[string]int64 `json:"offsets"`
}

// SuspendConsumerGroupInput is the input for the SuspendConsumerGroup activity.
type SuspendConsumerGroupInput struct {
	ConsumerGroupID string `json:"consumerGroupId"`
}

// ResetConsumerOffsetsInput is the input for the ResetConsumerOffsets activity.
type ResetConsumerOffsetsInput struct {
	ConsumerGroupID string           `json:"consumerGroupId"`
	Offsets         map[string]int64 `json:"offsets"`
}

// ResumeConsumerGroupInput is the input for the ResumeConsumerGroup activity.
type ResumeConsumerGroupInput struct {
	ConsumerGroupID string `json:"consumerGroupId"`
}

// OffsetRestoreWorkflow restores consumer group offsets from a checkpoint for disaster recovery.
// This workflow is triggered manually via UI when a consumer group needs to be reset to a previous state.
//
// The workflow:
// 1. Fetches the checkpoint data containing saved offsets
// 2. Suspends the consumer group (temporarily rejects JoinGroup requests)
// 3. Resets offsets to the checkpoint values
// 4. Resumes the consumer group (allows JoinGroup requests again)
func OffsetRestoreWorkflow(ctx workflow.Context, input OffsetRestoreInput) (*OffsetRestoreResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OffsetRestoreWorkflow",
		"consumerGroupId", input.ConsumerGroupID,
		"checkpointId", input.CheckpointID,
		"requestedBy", input.RequestedBy,
	)

	// Configure activity options
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

	// Step 1: Fetch checkpoint data
	logger.Info("Step 1: Fetching checkpoint data", "checkpointId", input.CheckpointID)
	var fetchCheckpointResult FetchCheckpointResult
	err := workflow.ExecuteActivity(ctx, "FetchCheckpoint", FetchCheckpointInput{
		CheckpointID: input.CheckpointID,
	}).Get(ctx, &fetchCheckpointResult)
	if err != nil {
		logger.Error("Failed to fetch checkpoint", "error", err)
		return &OffsetRestoreResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	logger.Info("Checkpoint fetched successfully",
		"checkpointId", input.CheckpointID,
		"offsetCount", len(fetchCheckpointResult.Offsets),
	)

	// Step 2: Suspend consumer group (temporarily reject JoinGroup requests)
	logger.Info("Step 2: Suspending consumer group", "consumerGroupId", input.ConsumerGroupID)
	err = workflow.ExecuteActivity(ctx, "SuspendConsumerGroup", SuspendConsumerGroupInput{
		ConsumerGroupID: input.ConsumerGroupID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to suspend consumer group", "error", err)
		return &OffsetRestoreResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	logger.Info("Consumer group suspended", "consumerGroupId", input.ConsumerGroupID)

	// Step 3: Reset offsets to checkpoint values
	logger.Info("Step 3: Resetting consumer offsets",
		"consumerGroupId", input.ConsumerGroupID,
		"partitionCount", len(fetchCheckpointResult.Offsets),
	)
	err = workflow.ExecuteActivity(ctx, "ResetConsumerOffsets", ResetConsumerOffsetsInput{
		ConsumerGroupID: input.ConsumerGroupID,
		Offsets:         fetchCheckpointResult.Offsets,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to reset consumer offsets", "error", err)

		// Try to resume consumer group even if reset failed
		logger.Warn("Attempting to resume consumer group after reset failure")
		resumeErr := workflow.ExecuteActivity(ctx, "ResumeConsumerGroup", ResumeConsumerGroupInput{
			ConsumerGroupID: input.ConsumerGroupID,
		}).Get(ctx, nil)
		if resumeErr != nil {
			logger.Error("Failed to resume consumer group after reset failure", "error", resumeErr)
		}

		return &OffsetRestoreResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	partitionsReset := len(fetchCheckpointResult.Offsets)
	logger.Info("Consumer offsets reset successfully",
		"consumerGroupId", input.ConsumerGroupID,
		"partitionsReset", partitionsReset,
	)

	// Step 4: Resume consumer group (allow JoinGroup requests again)
	logger.Info("Step 4: Resuming consumer group", "consumerGroupId", input.ConsumerGroupID)
	err = workflow.ExecuteActivity(ctx, "ResumeConsumerGroup", ResumeConsumerGroupInput{
		ConsumerGroupID: input.ConsumerGroupID,
	}).Get(ctx, nil)
	if err != nil {
		// Non-fatal: offsets were reset successfully, log warning and continue
		logger.Warn("Failed to resume consumer group, but offsets were reset successfully",
			"consumerGroupId", input.ConsumerGroupID,
			"error", err,
		)
	} else {
		logger.Info("Consumer group resumed", "consumerGroupId", input.ConsumerGroupID)
	}

	logger.Info("OffsetRestoreWorkflow completed successfully",
		"consumerGroupId", input.ConsumerGroupID,
		"checkpointId", input.CheckpointID,
		"partitionsReset", partitionsReset,
	)

	return &OffsetRestoreResult{
		Success:         true,
		PartitionsReset: partitionsReset,
	}, nil
}
