// temporal-workflows/internal/workflows/topic_share_workflow.go
package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// TopicShareTaskQueue is the task queue for topic share workflows.
	// Used when registering workflows in temporal-workflows/cmd/worker/main.go
	TopicShareTaskQueue = "topic-share"
)

// TopicShareApprovedInput is the input for the topic share approval workflow
type TopicShareApprovedInput struct {
	ShareID           string     `json:"shareId"`
	TopicPhysicalName string     `json:"topicPhysicalName"`
	CredentialID      string     `json:"credentialId"`
	Permissions       []string   `json:"permissions"`
	ExpiresAt         *time.Time `json:"expiresAt,omitempty"`
	ApprovedBy        string     `json:"approvedBy"`
	TopicOwnerEmail   string     `json:"topicOwnerEmail"`
	RequesterEmail    string     `json:"requesterEmail"`
}

// TopicShareApprovedResult is the result of the topic share approval workflow
type TopicShareApprovedResult struct {
	Success bool   `json:"success"`
	ShareID string `json:"shareId"`
	Error   string `json:"error,omitempty"`
}

// TopicShareRevokedInput is the input for the topic share revocation workflow
type TopicShareRevokedInput struct {
	ShareID string `json:"shareId"`
}

// TopicShareRevokedResult is the result of the topic share revocation workflow
type TopicShareRevokedResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// TopicShareApprovedWorkflow orchestrates the provisioning of topic access after approval
func TopicShareApprovedWorkflow(ctx workflow.Context, input TopicShareApprovedInput) (TopicShareApprovedResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting TopicShareApprovedWorkflow",
		"shareId", input.ShareID,
		"topicPhysicalName", input.TopicPhysicalName,
		"credentialId", input.CredentialID,
		"permissions", input.Permissions,
		"approvedBy", input.ApprovedBy)

	// Configure activity options: 2 minute timeout, 5 retries with exponential backoff
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Update share status to "provisioning"
	logger.Info("Step 1: Updating share status to provisioning", "shareId", input.ShareID)
	err := workflow.ExecuteActivity(ctx, topicShareActivities.UpdateShareStatus, activities.UpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "provisioning",
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update share status to provisioning", "error", err)
		return TopicShareApprovedResult{
			Success: false,
			ShareID: input.ShareID,
			Error:   err.Error(),
		}, nil
	}

	// Step 2: Upsert topic ACL to Bifrost
	logger.Info("Step 2: Upserting topic ACL to Bifrost",
		"topicPhysicalName", input.TopicPhysicalName,
		"credentialId", input.CredentialID)
	var aclOutput activities.UpsertTopicACLOutput
	err = workflow.ExecuteActivity(ctx, topicShareActivities.UpsertTopicACL, activities.UpsertTopicACLInput{
		ShareID:           input.ShareID,
		TopicPhysicalName: input.TopicPhysicalName,
		CredentialID:      input.CredentialID,
		Permissions:       input.Permissions,
		ExpiresAt:         input.ExpiresAt,
	}).Get(ctx, &aclOutput)

	if err != nil {
		logger.Error("Failed to upsert topic ACL, rolling back to failed status", "error", err)

		// Rollback: Update share status to "failed"
		_ = workflow.ExecuteActivity(ctx, topicShareActivities.UpdateShareStatus, activities.UpdateShareStatusInput{
			ShareID: input.ShareID,
			Status:  "failed",
			Error:   err.Error(),
		}).Get(ctx, nil)

		return TopicShareApprovedResult{
			Success: false,
			ShareID: input.ShareID,
			Error:   err.Error(),
		}, nil
	}

	// Step 3: Update share status to "approved"
	logger.Info("Step 3: Updating share status to approved", "shareId", input.ShareID)
	err = workflow.ExecuteActivity(ctx, topicShareActivities.UpdateShareStatus, activities.UpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "approved",
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update share status to approved", "error", err)
		// Don't fail the workflow, ACL was already provisioned
	}

	// Step 4: Send share approved notification (non-blocking, ignore errors)
	logger.Info("Step 4: Sending share approval notification",
		"topicOwnerEmail", input.TopicOwnerEmail,
		"requesterEmail", input.RequesterEmail)

	// Use a separate context with shorter timeout for notifications
	notificationCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    2,
		},
	})

	notificationErr := workflow.ExecuteActivity(notificationCtx, topicShareActivities.SendShareApprovedNotification, activities.SendShareApprovedNotificationInput{
		ShareID:         input.ShareID,
		TopicOwnerEmail: input.TopicOwnerEmail,
		RequesterEmail:  input.RequesterEmail,
	}).Get(notificationCtx, nil)

	if notificationErr != nil {
		// Log but don't fail - notification is non-blocking
		logger.Warn("Failed to send share approval notification", "error", notificationErr)
	}

	logger.Info("TopicShareApprovedWorkflow completed successfully", "shareId", input.ShareID)

	return TopicShareApprovedResult{
		Success: true,
		ShareID: input.ShareID,
	}, nil
}

// TopicShareRevokedWorkflow orchestrates the revocation of topic access
func TopicShareRevokedWorkflow(ctx workflow.Context, input TopicShareRevokedInput) (TopicShareRevokedResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting TopicShareRevokedWorkflow", "shareId", input.ShareID)

	// Configure activity options: 2 minute timeout, 5 retries with exponential backoff
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Revoke topic ACL from Bifrost
	logger.Info("Step 1: Revoking topic ACL", "shareId", input.ShareID)
	err := workflow.ExecuteActivity(ctx, topicShareActivities.RevokeTopicACL, activities.RevokeTopicACLInput{
		ShareID: input.ShareID,
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to revoke topic ACL", "error", err)
		return TopicShareRevokedResult{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	// Step 2: Update share status to "revoked"
	logger.Info("Step 2: Updating share status to revoked", "shareId", input.ShareID)
	err = workflow.ExecuteActivity(ctx, topicShareActivities.UpdateShareStatus, activities.UpdateShareStatusInput{
		ShareID: input.ShareID,
		Status:  "revoked",
	}).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to update share status to revoked", "error", err)
		// Don't fail - ACL was already revoked, status update is best-effort
	}

	logger.Info("TopicShareRevokedWorkflow completed successfully", "shareId", input.ShareID)

	return TopicShareRevokedResult{
		Success: true,
	}, nil
}
