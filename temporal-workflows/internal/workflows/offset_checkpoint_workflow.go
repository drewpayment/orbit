// temporal-workflows/internal/workflows/offset_checkpoint_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// OffsetCheckpointTaskQueue is the task queue for offset checkpoint workflows
	OffsetCheckpointTaskQueue = "offset-checkpoint"
)

// OffsetCheckpointInput is the input for the offset checkpoint workflow.
// Empty struct as it checkpoints all active consumer groups.
type OffsetCheckpointInput struct{}

// OffsetCheckpointResult is the result of the offset checkpoint workflow.
type OffsetCheckpointResult struct {
	Success            bool   `json:"success"`
	CheckpointsCreated int    `json:"checkpointsCreated"`
	Error              string `json:"error,omitempty"`
}

// ConsumerGroupInfo contains information about a consumer group.
type ConsumerGroupInfo struct {
	ID               string `json:"id"`
	VirtualClusterID string `json:"virtualClusterId"`
	GroupID          string `json:"groupId"`
}

// FetchActiveConsumerGroupsInput is the input for the FetchActiveConsumerGroups activity.
type FetchActiveConsumerGroupsInput struct{}

// FetchActiveConsumerGroupsResult is the result of the FetchActiveConsumerGroups activity.
type FetchActiveConsumerGroupsResult struct {
	ConsumerGroups []ConsumerGroupInfo `json:"consumerGroups"`
}

// FetchConsumerOffsetsInput is the input for the FetchConsumerOffsets activity.
type FetchConsumerOffsetsInput struct {
	ConsumerGroupID  string `json:"consumerGroupId"`
	VirtualClusterID string `json:"virtualClusterId"`
}

// FetchConsumerOffsetsResult is the result of the FetchConsumerOffsets activity.
type FetchConsumerOffsetsResult struct {
	Offsets map[string]int64 `json:"offsets"` // partition -> offset
}

// StoreOffsetCheckpointInput is the input for the StoreOffsetCheckpoint activity.
type StoreOffsetCheckpointInput struct {
	ConsumerGroupID  string           `json:"consumerGroupId"`
	VirtualClusterID string           `json:"virtualClusterId"`
	Offsets          map[string]int64 `json:"offsets"`
	CheckpointedAt   time.Time        `json:"checkpointedAt"`
}

// OffsetCheckpointWorkflow periodically checkpoints consumer group offsets for disaster recovery.
// This workflow is scheduled to run every 15 minutes via a Temporal schedule.
//
// The workflow:
// 1. Fetches all active consumer groups
// 2. For each consumer group, fetches current offsets and stores a checkpoint
// 3. Returns the count of checkpoints created
func OffsetCheckpointWorkflow(ctx workflow.Context, input OffsetCheckpointInput) (*OffsetCheckpointResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OffsetCheckpointWorkflow")

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

	// Step 1: Fetch all active consumer groups
	logger.Info("Fetching active consumer groups")
	var fetchGroupsResult FetchActiveConsumerGroupsResult
	err := workflow.ExecuteActivity(ctx, "FetchActiveConsumerGroups", FetchActiveConsumerGroupsInput{}).Get(ctx, &fetchGroupsResult)
	if err != nil {
		logger.Error("Failed to fetch active consumer groups", "error", err)
		return &OffsetCheckpointResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	logger.Info("Found active consumer groups", "count", len(fetchGroupsResult.ConsumerGroups))

	// Get current time for consistent checkpointing across all groups
	checkpointTime := workflow.Now(ctx)

	// Step 2: Process each consumer group
	checkpointsCreated := 0
	for _, group := range fetchGroupsResult.ConsumerGroups {
		logger.Info("Processing consumer group",
			"groupId", group.GroupID,
			"virtualClusterId", group.VirtualClusterID,
		)

		// Fetch current offsets for this consumer group
		var offsetsResult FetchConsumerOffsetsResult
		err := workflow.ExecuteActivity(ctx, "FetchConsumerOffsets", FetchConsumerOffsetsInput{
			ConsumerGroupID:  group.ID,
			VirtualClusterID: group.VirtualClusterID,
		}).Get(ctx, &offsetsResult)
		if err != nil {
			logger.Warn("Failed to fetch offsets for consumer group, continuing to next",
				"groupId", group.GroupID,
				"error", err,
			)
			continue
		}

		// Store the checkpoint
		err = workflow.ExecuteActivity(ctx, "StoreOffsetCheckpoint", StoreOffsetCheckpointInput{
			ConsumerGroupID:  group.ID,
			VirtualClusterID: group.VirtualClusterID,
			Offsets:          offsetsResult.Offsets,
			CheckpointedAt:   checkpointTime,
		}).Get(ctx, nil)
		if err != nil {
			logger.Warn("Failed to store checkpoint for consumer group, continuing to next",
				"groupId", group.GroupID,
				"error", err,
			)
			continue
		}

		checkpointsCreated++
		logger.Info("Checkpoint created for consumer group",
			"groupId", group.GroupID,
			"offsetCount", len(offsetsResult.Offsets),
		)
	}

	logger.Info("OffsetCheckpointWorkflow completed",
		"checkpointsCreated", checkpointsCreated,
		"totalGroups", len(fetchGroupsResult.ConsumerGroups),
	)

	return &OffsetCheckpointResult{
		Success:            true,
		CheckpointsCreated: checkpointsCreated,
	}, nil
}
