package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// ApplicationCleanupTaskQueue is the task queue for application cleanup workflows
	ApplicationCleanupTaskQueue = "application-cleanup"
)

// ApplicationCleanupInput contains the input for cleaning up an application after grace period
type ApplicationCleanupInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// ApplicationCleanupResult contains the result of the cleanup workflow
type ApplicationCleanupResult struct {
	Success            bool   `json:"success"`
	Status             string `json:"status"` // "completed", "cancelled", "failed"
	TopicsDeleted      int    `json:"topicsDeleted"`
	CredentialsRevoked int    `json:"credentialsRevoked"`
	Error              string `json:"error,omitempty"`
}

// CheckApplicationStatusInput is the input for checking application status
type CheckApplicationStatusInput struct {
	ApplicationID string `json:"applicationId"`
}

// CheckApplicationStatusResult is the result of checking application status
type CheckApplicationStatusResult struct {
	Status     string `json:"status"`
	CanProceed bool   `json:"canProceed"`
	Error      string `json:"error,omitempty"`
}

// DeletePhysicalTopicsInput is the input for deleting physical topics
type DeletePhysicalTopicsInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// DeletePhysicalTopicsResult is the result of deleting physical topics
type DeletePhysicalTopicsResult struct {
	Success       bool     `json:"success"`
	DeletedTopics []string `json:"deletedTopics"`
	FailedTopics  []string `json:"failedTopics,omitempty"`
	Error         string   `json:"error,omitempty"`
}

// RevokeAllCredentialsInput is the input for revoking all credentials
type RevokeAllCredentialsInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// RevokeAllCredentialsResult is the result of revoking all credentials
type RevokeAllCredentialsResult struct {
	Success            bool     `json:"success"`
	RevokedCredentials []string `json:"revokedCredentials"`
	FailedCredentials  []string `json:"failedCredentials,omitempty"`
	Error              string   `json:"error,omitempty"`
}

// DeleteVirtualClustersInput is the input for deleting virtual clusters from Bifrost
type DeleteVirtualClustersInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// DeleteVirtualClustersResult is the result of deleting virtual clusters from Bifrost
type DeleteVirtualClustersResult struct {
	Success                bool     `json:"success"`
	DeletedVirtualClusters []string `json:"deletedVirtualClusters"`
	FailedVirtualClusters  []string `json:"failedVirtualClusters,omitempty"`
	Error                  string   `json:"error,omitempty"`
}

// ArchiveMetricsDataInput is the input for archiving metrics data
type ArchiveMetricsDataInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// ArchiveMetricsDataResult is the result of archiving metrics data
type ArchiveMetricsDataResult struct {
	Success       bool   `json:"success"`
	ArchiveID     string `json:"archiveId,omitempty"`
	BytesArchived int64  `json:"bytesArchived"`
	Error         string `json:"error,omitempty"`
}

// ApplicationCleanupWorkflow orchestrates the cleanup of a Kafka application after the grace period expires.
// It deletes physical topics, revokes credentials, removes virtual clusters from Bifrost,
// archives metrics data, and marks the application as deleted.
func ApplicationCleanupWorkflow(ctx workflow.Context, input ApplicationCleanupInput) (*ApplicationCleanupResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ApplicationCleanupWorkflow",
		"applicationId", input.ApplicationID,
		"workspaceId", input.WorkspaceID,
	)

	// Configure activity options with retry policy (longer timeouts for cleanup operations)
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    2 * time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Track cleanup progress
	var topicsDeleted int
	var credentialsRevoked int

	// Step 1: Check application status
	// If status is NOT "decommissioning", user might have cancelled during grace period
	logger.Info("Step 1: Checking application status")
	var statusResult CheckApplicationStatusResult
	err := workflow.ExecuteActivity(ctx, "CheckApplicationStatus", CheckApplicationStatusInput{
		ApplicationID: input.ApplicationID,
	}).Get(ctx, &statusResult)
	if err != nil {
		logger.Error("Failed to check application status", "error", err)
		return &ApplicationCleanupResult{
			Success: false,
			Status:  "failed",
			Error:   fmt.Sprintf("Failed to check application status: %v", err),
		}, nil
	}

	if !statusResult.CanProceed {
		logger.Info("Application cleanup cancelled - status is not decommissioning",
			"applicationId", input.ApplicationID,
			"currentStatus", statusResult.Status)
		return &ApplicationCleanupResult{
			Success: true,
			Status:  "cancelled",
		}, nil
	}

	logger.Info("Application status verified, proceeding with cleanup",
		"currentStatus", statusResult.Status)

	// Step 2: Delete physical topics (continue on error)
	logger.Info("Step 2: Deleting physical topics")
	var topicsResult DeletePhysicalTopicsResult
	err = workflow.ExecuteActivity(ctx, "DeletePhysicalTopics", DeletePhysicalTopicsInput{
		ApplicationID: input.ApplicationID,
		WorkspaceID:   input.WorkspaceID,
	}).Get(ctx, &topicsResult)
	if err != nil {
		logger.Error("Failed to delete physical topics", "error", err)
		// Continue on error - other cleanup steps should still proceed
	} else if !topicsResult.Success {
		logger.Warn("DeletePhysicalTopics returned failure",
			"error", topicsResult.Error,
			"failedTopics", topicsResult.FailedTopics)
	} else {
		topicsDeleted = len(topicsResult.DeletedTopics)
		logger.Info("Physical topics deleted",
			"deletedCount", topicsDeleted,
			"deletedTopics", topicsResult.DeletedTopics)
	}

	// Step 3: Revoke all credentials (continue on error)
	logger.Info("Step 3: Revoking all credentials")
	var credentialsResult RevokeAllCredentialsResult
	err = workflow.ExecuteActivity(ctx, "RevokeAllCredentials", RevokeAllCredentialsInput{
		ApplicationID: input.ApplicationID,
		WorkspaceID:   input.WorkspaceID,
	}).Get(ctx, &credentialsResult)
	if err != nil {
		logger.Error("Failed to revoke credentials", "error", err)
		// Continue on error - other cleanup steps should still proceed
	} else if !credentialsResult.Success {
		logger.Warn("RevokeAllCredentials returned failure",
			"error", credentialsResult.Error,
			"failedCredentials", credentialsResult.FailedCredentials)
	} else {
		credentialsRevoked = len(credentialsResult.RevokedCredentials)
		logger.Info("Credentials revoked",
			"revokedCount", credentialsRevoked,
			"revokedCredentials", credentialsResult.RevokedCredentials)
	}

	// Step 4: Delete virtual clusters from Bifrost (continue on error)
	logger.Info("Step 4: Deleting virtual clusters from Bifrost")
	var virtualClustersResult DeleteVirtualClustersResult
	err = workflow.ExecuteActivity(ctx, "DeleteVirtualClustersFromBifrost", DeleteVirtualClustersInput{
		ApplicationID: input.ApplicationID,
		WorkspaceID:   input.WorkspaceID,
	}).Get(ctx, &virtualClustersResult)
	if err != nil {
		logger.Error("Failed to delete virtual clusters from Bifrost", "error", err)
		// Continue on error - other cleanup steps should still proceed
	} else if !virtualClustersResult.Success {
		logger.Warn("DeleteVirtualClustersFromBifrost returned failure",
			"error", virtualClustersResult.Error,
			"failedVirtualClusters", virtualClustersResult.FailedVirtualClusters)
	} else {
		logger.Info("Virtual clusters deleted from Bifrost",
			"deletedCount", len(virtualClustersResult.DeletedVirtualClusters),
			"deletedVirtualClusters", virtualClustersResult.DeletedVirtualClusters)
	}

	// Step 5: Archive metrics data (non-fatal)
	logger.Info("Step 5: Archiving metrics data")
	var archiveResult ArchiveMetricsDataResult
	err = workflow.ExecuteActivity(ctx, "ArchiveMetricsData", ArchiveMetricsDataInput{
		ApplicationID: input.ApplicationID,
		WorkspaceID:   input.WorkspaceID,
	}).Get(ctx, &archiveResult)
	if err != nil {
		logger.Warn("Failed to archive metrics data (non-fatal)", "error", err)
		// Non-fatal - continue with marking application deleted
	} else if !archiveResult.Success {
		logger.Warn("ArchiveMetricsData returned failure (non-fatal)",
			"error", archiveResult.Error)
	} else {
		logger.Info("Metrics data archived",
			"archiveId", archiveResult.ArchiveID,
			"bytesArchived", archiveResult.BytesArchived)
	}

	// Step 6: Mark application as deleted (critical - if this fails, mark workflow as failed)
	logger.Info("Step 6: Marking application as deleted")
	err = workflow.ExecuteActivity(ctx, "MarkApplicationDeleted", MarkApplicationDeletedInput{
		ApplicationID: input.ApplicationID,
		DeletedAt:     workflow.Now(ctx),
		Reason:        "cleanup_after_grace_period",
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to mark application as deleted", "error", err)
		return &ApplicationCleanupResult{
			Success:            false,
			Status:             "failed",
			TopicsDeleted:      topicsDeleted,
			CredentialsRevoked: credentialsRevoked,
			Error:              fmt.Sprintf("Failed to mark application as deleted: %v", err),
		}, nil
	}

	logger.Info("ApplicationCleanupWorkflow completed successfully",
		"applicationId", input.ApplicationID,
		"topicsDeleted", topicsDeleted,
		"credentialsRevoked", credentialsRevoked)

	return &ApplicationCleanupResult{
		Success:            true,
		Status:             "completed",
		TopicsDeleted:      topicsDeleted,
		CredentialsRevoked: credentialsRevoked,
	}, nil
}
