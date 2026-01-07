// temporal-workflows/internal/workflows/topic_sync_workflow.go
package workflows

import (
	"context"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

const (
	// TopicSyncTaskQueue is the task queue for topic sync workflows
	TopicSyncTaskQueue = "topic-sync"
)

// Activity function stubs - these will be replaced with actual implementations when registering with worker
var (
	createTopicRecordActivityStub = func(ctx context.Context, input activities.CreateTopicRecordInput) (*activities.CreateTopicRecordOutput, error) {
		panic("createTopicRecordActivityStub not implemented - register actual activity implementation")
	}
	markTopicDeletedActivityStub = func(ctx context.Context, input activities.MarkTopicDeletedInput) error {
		panic("markTopicDeletedActivityStub not implemented - register actual activity implementation")
	}
	updateTopicConfigActivityStub = func(ctx context.Context, input activities.UpdateTopicConfigInput) error {
		panic("updateTopicConfigActivityStub not implemented - register actual activity implementation")
	}
)

// TopicCreatedSyncInput is the input for syncing a topic created via gateway passthrough
type TopicCreatedSyncInput struct {
	VirtualClusterID      string            `json:"virtualClusterId"`
	VirtualName           string            `json:"virtualName"`
	PhysicalName          string            `json:"physicalName"`
	Partitions            int               `json:"partitions"`
	ReplicationFactor     int               `json:"replicationFactor"`
	Config                map[string]string `json:"config"`
	CreatedByCredentialID string            `json:"createdByCredentialId"`
}

// TopicCreatedSyncResult is the result of syncing a created topic
type TopicCreatedSyncResult struct {
	TopicID string `json:"topicId"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// TopicDeletedSyncInput is the input for syncing a topic deleted via gateway passthrough
type TopicDeletedSyncInput struct {
	VirtualClusterID      string `json:"virtualClusterId"`
	VirtualName           string `json:"virtualName"`
	PhysicalName          string `json:"physicalName"`
	DeletedByCredentialID string `json:"deletedByCredentialId"`
}

// TopicDeletedSyncResult is the result of syncing a deleted topic
type TopicDeletedSyncResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// TopicConfigSyncInput is the input for syncing topic config changes via gateway passthrough
type TopicConfigSyncInput struct {
	VirtualClusterID      string            `json:"virtualClusterId"`
	VirtualName           string            `json:"virtualName"`
	Config                map[string]string `json:"config"`
	UpdatedByCredentialID string            `json:"updatedByCredentialId"`
}

// TopicCreatedSyncWorkflow syncs a topic created via gateway passthrough back to Orbit
func TopicCreatedSyncWorkflow(ctx workflow.Context, input TopicCreatedSyncInput) (*TopicCreatedSyncResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting TopicCreatedSyncWorkflow",
		"virtualClusterId", input.VirtualClusterID,
		"virtualName", input.VirtualName,
		"physicalName", input.PhysicalName)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Call CreateTopicRecord activity to create topic in Orbit
	activityInput := activities.CreateTopicRecordInput{
		VirtualClusterID:      input.VirtualClusterID,
		VirtualName:           input.VirtualName,
		PhysicalName:          input.PhysicalName,
		Partitions:            input.Partitions,
		ReplicationFactor:     input.ReplicationFactor,
		Config:                input.Config,
		CreatedByCredentialID: input.CreatedByCredentialID,
	}

	var result activities.CreateTopicRecordOutput
	err := workflow.ExecuteActivity(ctx, createTopicRecordActivityStub, activityInput).Get(ctx, &result)

	if err != nil {
		logger.Error("Failed to create topic record in Orbit", "error", err)
		return &TopicCreatedSyncResult{
			Error: err.Error(),
		}, nil
	}

	logger.Info("TopicCreatedSyncWorkflow completed successfully",
		"topicId", result.TopicID,
		"status", result.Status)

	return &TopicCreatedSyncResult{
		TopicID: result.TopicID,
		Status:  result.Status,
	}, nil
}

// TopicDeletedSyncWorkflow syncs a topic deleted via gateway passthrough back to Orbit
func TopicDeletedSyncWorkflow(ctx workflow.Context, input TopicDeletedSyncInput) (*TopicDeletedSyncResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting TopicDeletedSyncWorkflow",
		"virtualClusterId", input.VirtualClusterID,
		"virtualName", input.VirtualName,
		"physicalName", input.PhysicalName)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Call MarkTopicDeleted activity
	activityInput := activities.MarkTopicDeletedInput{
		VirtualClusterID:      input.VirtualClusterID,
		VirtualName:           input.VirtualName,
		PhysicalName:          input.PhysicalName,
		DeletedByCredentialID: input.DeletedByCredentialID,
	}

	err := workflow.ExecuteActivity(ctx, markTopicDeletedActivityStub, activityInput).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to mark topic as deleted in Orbit", "error", err)
		return &TopicDeletedSyncResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	logger.Info("TopicDeletedSyncWorkflow completed successfully")

	return &TopicDeletedSyncResult{
		Success: true,
	}, nil
}

// TopicConfigSyncWorkflow syncs topic config changes via gateway passthrough back to Orbit
func TopicConfigSyncWorkflow(ctx workflow.Context, input TopicConfigSyncInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting TopicConfigSyncWorkflow",
		"virtualClusterId", input.VirtualClusterID,
		"virtualName", input.VirtualName)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Call UpdateTopicConfig activity
	activityInput := activities.UpdateTopicConfigInput{
		VirtualClusterID:      input.VirtualClusterID,
		VirtualName:           input.VirtualName,
		Config:                input.Config,
		UpdatedByCredentialID: input.UpdatedByCredentialID,
	}

	err := workflow.ExecuteActivity(ctx, updateTopicConfigActivityStub, activityInput).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to update topic config in Orbit", "error", err)
		return err
	}

	logger.Info("TopicConfigSyncWorkflow completed successfully")

	return nil
}
