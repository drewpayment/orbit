package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// KafkaTopicProvisioningTaskQueue is the task queue for topic provisioning workflows
	KafkaTopicProvisioningTaskQueue = "kafka-topic-provisioning"
)

// TopicProvisioningWorkflowInput defines input for the topic provisioning workflow
type TopicProvisioningWorkflowInput struct {
	TopicID           string
	WorkspaceID       string
	Environment       string
	TopicName         string
	Partitions        int
	ReplicationFactor int
	RetentionMs       int64
	CleanupPolicy     string
	Compression       string
	Config            map[string]string
}

// TopicProvisioningWorkflowResult defines the output of the topic provisioning workflow
type TopicProvisioningWorkflowResult struct {
	TopicID   string
	FullName  string
	ClusterID string
	Status    string
	Error     string
}

// TopicProvisioningWorkflow orchestrates the provisioning of a Kafka topic
func TopicProvisioningWorkflow(ctx workflow.Context, input TopicProvisioningWorkflowInput) (TopicProvisioningWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting topic provisioning workflow",
		"TopicID", input.TopicID,
		"TopicName", input.TopicName,
		"Environment", input.Environment,
	)

	// Configure activity options with retry policy
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var kafkaActivities *activities.KafkaActivitiesImpl

	// Step 1: Update status to provisioning
	logger.Info("Step 1: Updating topic status to provisioning")
	err := workflow.ExecuteActivity(ctx, kafkaActivities.UpdateTopicStatus, activities.KafkaUpdateTopicStatusInput{
		TopicID: input.TopicID,
		Status:  "provisioning",
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update topic status", "Error", err)
		// Continue anyway - status update is not critical
	}

	// Step 2: Provision topic on Kafka cluster
	logger.Info("Step 2: Provisioning topic on Kafka cluster",
		"Partitions", input.Partitions,
		"ReplicationFactor", input.ReplicationFactor,
	)
	provisionInput := activities.KafkaTopicProvisionInput{
		TopicID:           input.TopicID,
		WorkspaceID:       input.WorkspaceID,
		Environment:       input.Environment,
		TopicName:         input.TopicName,
		Partitions:        input.Partitions,
		ReplicationFactor: input.ReplicationFactor,
		RetentionMs:       input.RetentionMs,
		CleanupPolicy:     input.CleanupPolicy,
		Compression:       input.Compression,
		Config:            input.Config,
	}

	var provisionOutput *activities.KafkaTopicProvisionOutput
	err = workflow.ExecuteActivity(ctx, kafkaActivities.ProvisionTopic, provisionInput).Get(ctx, &provisionOutput)
	if err != nil {
		logger.Error("Failed to provision topic", "Error", err)

		// Update status to failed
		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateTopicStatus, activities.KafkaUpdateTopicStatusInput{
			TopicID: input.TopicID,
			Status:  "failed",
			Error:   err.Error(),
		}).Get(ctx, nil)

		return TopicProvisioningWorkflowResult{
			TopicID: input.TopicID,
			Status:  "failed",
			Error:   err.Error(),
		}, err
	}

	// Step 3: Update status to active
	logger.Info("Step 3: Updating topic status to active")
	err = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateTopicStatus, activities.KafkaUpdateTopicStatusInput{
		TopicID:   input.TopicID,
		Status:    "active",
		ClusterID: provisionOutput.ClusterID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update topic status to active", "Error", err)
		// Topic is provisioned, but status update failed - log and continue
	}

	logger.Info("Topic provisioning workflow completed successfully",
		"TopicID", input.TopicID,
		"FullName", provisionOutput.FullName,
		"ClusterID", provisionOutput.ClusterID,
	)

	return TopicProvisioningWorkflowResult{
		TopicID:   input.TopicID,
		FullName:  provisionOutput.FullName,
		ClusterID: provisionOutput.ClusterID,
		Status:    "active",
	}, nil
}

// TopicDeletionWorkflowInput defines input for the topic deletion workflow
type TopicDeletionWorkflowInput struct {
	TopicID   string
	FullName  string
	ClusterID string
}

// TopicDeletionWorkflowResult defines the output of the topic deletion workflow
type TopicDeletionWorkflowResult struct {
	TopicID string
	Status  string
	Error   string
}

// TopicDeletionWorkflow orchestrates the deletion of a Kafka topic
func TopicDeletionWorkflow(ctx workflow.Context, input TopicDeletionWorkflowInput) (TopicDeletionWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting topic deletion workflow",
		"TopicID", input.TopicID,
		"FullName", input.FullName,
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

	var kafkaActivities *activities.KafkaActivitiesImpl

	// Step 1: Delete topic from Kafka cluster
	logger.Info("Step 1: Deleting topic from Kafka cluster")
	err := workflow.ExecuteActivity(ctx, kafkaActivities.DeleteTopic, input.TopicID, input.FullName, input.ClusterID).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to delete topic from cluster", "Error", err)

		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateTopicStatus, activities.KafkaUpdateTopicStatusInput{
			TopicID: input.TopicID,
			Status:  "failed",
			Error:   err.Error(),
		}).Get(ctx, nil)

		return TopicDeletionWorkflowResult{
			TopicID: input.TopicID,
			Status:  "failed",
			Error:   err.Error(),
		}, err
	}

	// Step 2: Update status to deleted
	logger.Info("Step 2: Updating topic status to deleted")
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateTopicStatus, activities.KafkaUpdateTopicStatusInput{
		TopicID: input.TopicID,
		Status:  "deleted",
	}).Get(ctx, nil)

	logger.Info("Topic deletion workflow completed successfully", "TopicID", input.TopicID)

	return TopicDeletionWorkflowResult{
		TopicID: input.TopicID,
		Status:  "deleted",
	}, nil
}
