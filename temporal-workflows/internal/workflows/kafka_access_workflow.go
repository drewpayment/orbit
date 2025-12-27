package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// KafkaAccessProvisioningTaskQueue is the task queue for access provisioning workflows
	KafkaAccessProvisioningTaskQueue = "kafka-access-provisioning"
)

// AccessProvisioningWorkflowInput defines input for the access provisioning workflow
type AccessProvisioningWorkflowInput struct {
	ShareID     string
	TopicID     string
	TopicName   string
	WorkspaceID string
	Permission  string // "read", "write", "read_write"
	ExpiresAt   *time.Time
}

// AccessProvisioningWorkflowResult defines the output of the access provisioning workflow
type AccessProvisioningWorkflowResult struct {
	ShareID     string
	ACLsCreated []string
	Status      string
	Error       string
}

// AccessProvisioningWorkflow orchestrates the provisioning of topic access
func AccessProvisioningWorkflow(ctx workflow.Context, input AccessProvisioningWorkflowInput) (AccessProvisioningWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting access provisioning workflow",
		"ShareID", input.ShareID,
		"TopicID", input.TopicID,
		"WorkspaceID", input.WorkspaceID,
		"Permission", input.Permission,
	)

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 3 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var kafkaActivities *activities.KafkaActivitiesImpl

	// Step 1: Update share status to provisioning
	logger.Info("Step 1: Updating share status to provisioning")
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "provisioning",
	}).Get(ctx, nil)

	// Step 2: Provision access on Kafka cluster (create ACLs)
	logger.Info("Step 2: Creating ACLs on Kafka cluster")
	provisionInput := activities.KafkaAccessProvisionInput{
		ShareID:     input.ShareID,
		TopicID:     input.TopicID,
		WorkspaceID: input.WorkspaceID,
		Permission:  input.Permission,
	}

	var provisionOutput *activities.KafkaAccessProvisionOutput
	err := workflow.ExecuteActivity(ctx, kafkaActivities.ProvisionAccess, provisionInput).Get(ctx, &provisionOutput)
	if err != nil {
		logger.Error("Failed to provision access", "Error", err)

		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
			ShareID: input.ShareID,
			Status:  "failed",
			Error:   err.Error(),
		}).Get(ctx, nil)

		return AccessProvisioningWorkflowResult{
			ShareID: input.ShareID,
			Status:  "failed",
			Error:   err.Error(),
		}, err
	}

	// Step 3: Update share status to active
	logger.Info("Step 3: Updating share status to active")
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "active",
	}).Get(ctx, nil)

	// Step 4: If access has an expiration, schedule revocation
	if input.ExpiresAt != nil {
		expirationDuration := input.ExpiresAt.Sub(workflow.Now(ctx))
		if expirationDuration > 0 {
			logger.Info("Step 4: Scheduling access revocation",
				"ExpiresAt", input.ExpiresAt,
				"Duration", expirationDuration,
			)

			// Wait until expiration
			_ = workflow.Sleep(ctx, expirationDuration)

			// Revoke access
			logger.Info("Access expired, revoking")
			err = workflow.ExecuteActivity(ctx, kafkaActivities.RevokeAccess, input.ShareID, input.TopicID, input.WorkspaceID).Get(ctx, nil)
			if err != nil {
				logger.Error("Failed to revoke expired access", "Error", err)
			}

			_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
				ShareID: input.ShareID,
				Status:  "expired",
			}).Get(ctx, nil)

			return AccessProvisioningWorkflowResult{
				ShareID:     input.ShareID,
				ACLsCreated: provisionOutput.ACLsCreated,
				Status:      "expired",
			}, nil
		}
	}

	logger.Info("Access provisioning workflow completed successfully",
		"ShareID", input.ShareID,
		"ACLsCreated", len(provisionOutput.ACLsCreated),
	)

	return AccessProvisioningWorkflowResult{
		ShareID:     input.ShareID,
		ACLsCreated: provisionOutput.ACLsCreated,
		Status:      "active",
	}, nil
}

// AccessRevocationWorkflowInput defines input for the access revocation workflow
type AccessRevocationWorkflowInput struct {
	ShareID     string
	TopicID     string
	WorkspaceID string
}

// AccessRevocationWorkflowResult defines the output of the access revocation workflow
type AccessRevocationWorkflowResult struct {
	ShareID string
	Status  string
	Error   string
}

// AccessRevocationWorkflow orchestrates the revocation of topic access
func AccessRevocationWorkflow(ctx workflow.Context, input AccessRevocationWorkflowInput) (AccessRevocationWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting access revocation workflow",
		"ShareID", input.ShareID,
		"TopicID", input.TopicID,
	)

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var kafkaActivities *activities.KafkaActivitiesImpl

	// Step 1: Update share status to revoking
	logger.Info("Step 1: Updating share status to revoking")
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "revoking",
	}).Get(ctx, nil)

	// Step 2: Revoke access on Kafka cluster (delete ACLs)
	logger.Info("Step 2: Deleting ACLs from Kafka cluster")
	err := workflow.ExecuteActivity(ctx, kafkaActivities.RevokeAccess, input.ShareID, input.TopicID, input.WorkspaceID).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to revoke access", "Error", err)

		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
			ShareID: input.ShareID,
			Status:  "failed",
			Error:   err.Error(),
		}).Get(ctx, nil)

		return AccessRevocationWorkflowResult{
			ShareID: input.ShareID,
			Status:  "failed",
			Error:   err.Error(),
		}, err
	}

	// Step 3: Update share status to revoked
	logger.Info("Step 3: Updating share status to revoked")
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateShareStatus, activities.KafkaUpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "revoked",
	}).Get(ctx, nil)

	logger.Info("Access revocation workflow completed successfully", "ShareID", input.ShareID)

	return AccessRevocationWorkflowResult{
		ShareID: input.ShareID,
		Status:  "revoked",
	}, nil
}
