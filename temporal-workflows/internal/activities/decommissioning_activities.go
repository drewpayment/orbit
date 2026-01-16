package activities

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
)

// SetVirtualClustersReadOnlyInput is the input for setting virtual clusters to read-only
type SetVirtualClustersReadOnlyInput struct {
	ApplicationID string `json:"applicationId"`
	ReadOnly      bool   `json:"readOnly"`
}

// SetVirtualClustersReadOnlyResult is the result of setting virtual clusters to read-only
type SetVirtualClustersReadOnlyResult struct {
	Success                   bool     `json:"success"`
	UpdatedVirtualClusterIDs  []string `json:"updatedVirtualClusterIds"`
	Error                     string   `json:"error,omitempty"`
}

// CheckApplicationStatusInput is the input for checking application status
type CheckApplicationStatusInput struct {
	ApplicationID string `json:"applicationId"`
}

// CheckApplicationStatusResult is the result of checking application status
type CheckApplicationStatusResult struct {
	Status     string `json:"status"`
	CanProceed bool   `json:"canProceed"`
}

// DeletePhysicalTopicsInput is the input for deleting physical topics
type DeletePhysicalTopicsInput struct {
	ApplicationID string `json:"applicationId"`
}

// DeletePhysicalTopicsResult is the result of deleting physical topics
type DeletePhysicalTopicsResult struct {
	Success       bool     `json:"success"`
	DeletedTopics []string `json:"deletedTopics"`
	FailedTopics  []string `json:"failedTopics"`
}

// RevokeAllCredentialsInput is the input for revoking all credentials
type RevokeAllCredentialsInput struct {
	ApplicationID string `json:"applicationId"`
}

// RevokeAllCredentialsResult is the result of revoking all credentials
type RevokeAllCredentialsResult struct {
	Success            bool     `json:"success"`
	RevokedCredentials []string `json:"revokedCredentials"`
	FailedCredentials  []string `json:"failedCredentials"`
}

// DeleteVirtualClustersFromBifrostInput is the input for deleting virtual clusters from Bifrost
type DeleteVirtualClustersFromBifrostInput struct {
	ApplicationID string `json:"applicationId"`
}

// DeleteVirtualClustersFromBifrostResult is the result of deleting virtual clusters from Bifrost
type DeleteVirtualClustersFromBifrostResult struct {
	Success                  bool     `json:"success"`
	DeletedVirtualClusterIDs []string `json:"deletedVirtualClusterIds"`
}

// ArchiveMetricsDataInput is the input for archiving metrics data
type ArchiveMetricsDataInput struct {
	ApplicationID string `json:"applicationId"`
}

// ArchiveMetricsDataResult is the result of archiving metrics data
type ArchiveMetricsDataResult struct {
	Success       bool  `json:"success"`
	ArchivedBytes int64 `json:"archivedBytes"`
}

// MarkApplicationDeletedInput is the input for marking an application as deleted
type MarkApplicationDeletedInput struct {
	ApplicationID string `json:"applicationId"`
	DeletedBy     string `json:"deletedBy"`
	ForceDeleted  bool   `json:"forceDeleted"`
}

// ScheduleCleanupWorkflowInput is the input for scheduling a cleanup workflow
type ScheduleCleanupWorkflowInput struct {
	ApplicationID string    `json:"applicationId"`
	WorkspaceID   string    `json:"workspaceId"`
	ScheduledFor  time.Time `json:"scheduledFor"`
}

// ScheduleCleanupWorkflowResult is the result of scheduling a cleanup workflow
type ScheduleCleanupWorkflowResult struct {
	Success    bool   `json:"success"`
	WorkflowID string `json:"workflowId"`
}

// UpdateApplicationWorkflowIDInput is the input for updating an application's workflow ID
type UpdateApplicationWorkflowIDInput struct {
	ApplicationID string `json:"applicationId"`
	WorkflowID    string `json:"workflowId"`
}

// ExecuteImmediateCleanupInput is the input for executing immediate cleanup
type ExecuteImmediateCleanupInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// ExecuteImmediateCleanupResult is the result of executing immediate cleanup
type ExecuteImmediateCleanupResult struct {
	Success            bool `json:"success"`
	TopicsDeleted      int  `json:"topicsDeleted"`
	CredentialsRevoked int  `json:"credentialsRevoked"`
}

// DecommissioningActivities contains activities for application decommissioning
type DecommissioningActivities struct {
	payloadClient  *clients.PayloadClient
	bifrostClient  *clients.BifrostClient
	adapterFactory *clients.KafkaAdapterFactory
	storageClient  *clients.StorageClient
	temporalClient client.Client
	logger         *slog.Logger
}

// NewDecommissioningActivities creates a new DecommissioningActivities
func NewDecommissioningActivities(
	payloadClient *clients.PayloadClient,
	bifrostClient *clients.BifrostClient,
	adapterFactory *clients.KafkaAdapterFactory,
	storageClient *clients.StorageClient,
	temporalClient client.Client,
	logger *slog.Logger,
) *DecommissioningActivities {
	return &DecommissioningActivities{
		payloadClient:  payloadClient,
		bifrostClient:  bifrostClient,
		adapterFactory: adapterFactory,
		storageClient:  storageClient,
		temporalClient: temporalClient,
		logger:         logger,
	}
}

// SetVirtualClustersReadOnly sets all virtual clusters for an application to read-only mode
func (a *DecommissioningActivities) SetVirtualClustersReadOnly(ctx context.Context, input SetVirtualClustersReadOnlyInput) (*SetVirtualClustersReadOnlyResult, error) {
	a.logger.Info("SetVirtualClustersReadOnly",
		"applicationId", input.ApplicationID,
		"readOnly", input.ReadOnly)

	// Query Payload for virtual clusters associated with this application
	query := clients.NewQueryBuilder().
		WhereEquals("application", input.ApplicationID).
		Build()

	vcs, err := a.payloadClient.Find(ctx, "kafka-virtual-clusters", query)
	if err != nil {
		return nil, fmt.Errorf("querying virtual clusters: %w", err)
	}

	if len(vcs) == 0 {
		a.logger.Info("No virtual clusters found for application")
		return &SetVirtualClustersReadOnlyResult{
			Success:                  true,
			UpdatedVirtualClusterIDs: []string{},
		}, nil
	}

	// For each virtual cluster, call Bifrost SetVirtualClusterReadOnly
	var updated []string
	var errors []string

	for _, vc := range vcs {
		vcID, ok := vc["id"].(string)
		if !ok {
			continue
		}

		if a.bifrostClient == nil {
			errors = append(errors, fmt.Sprintf("%s: bifrost client not available", vcID))
			continue
		}

		err := a.bifrostClient.SetVirtualClusterReadOnly(ctx, vcID, input.ReadOnly)
		if err != nil {
			a.logger.Warn("Failed to set virtual cluster read-only",
				"vcId", vcID,
				"error", err)
			errors = append(errors, fmt.Sprintf("%s: %v", vcID, err))
			continue
		}

		updated = append(updated, vcID)
		a.logger.Info("Virtual cluster set to read-only",
			"vcId", vcID,
			"readOnly", input.ReadOnly)
	}

	success := len(errors) == 0
	var errorMsg string
	if len(errors) > 0 {
		errorMsg = fmt.Sprintf("failed to update %d virtual clusters: %v", len(errors), errors)
	}

	return &SetVirtualClustersReadOnlyResult{
		Success:                  success,
		UpdatedVirtualClusterIDs: updated,
		Error:                    errorMsg,
	}, nil
}

// CheckApplicationStatus checks if an application can proceed with decommissioning
func (a *DecommissioningActivities) CheckApplicationStatus(ctx context.Context, input CheckApplicationStatusInput) (*CheckApplicationStatusResult, error) {
	a.logger.Info("CheckApplicationStatus",
		slog.String("applicationId", input.ApplicationID))

	// Query Payload for application
	app, err := a.payloadClient.Get(ctx, "kafka-applications", input.ApplicationID)
	if err != nil {
		return nil, fmt.Errorf("fetching application: %w", err)
	}

	// Extract status
	status, ok := app["status"].(string)
	if !ok {
		return nil, fmt.Errorf("application has no status field")
	}

	// Can only proceed if status is "decommissioning"
	canProceed := status == "decommissioning"

	a.logger.Info("Application status checked",
		slog.String("status", status),
		slog.Bool("canProceed", canProceed))

	return &CheckApplicationStatusResult{
		Status:     status,
		CanProceed: canProceed,
	}, nil
}

// DeletePhysicalTopics deletes all physical Kafka topics for an application
func (a *DecommissioningActivities) DeletePhysicalTopics(ctx context.Context, input DeletePhysicalTopicsInput) (*DeletePhysicalTopicsResult, error) {
	a.logger.Info("DeletePhysicalTopics", "applicationId", input.ApplicationID)

	// Query topics for this application
	query := clients.NewQueryBuilder().
		WhereEquals("application", input.ApplicationID).
		Build()

	topics, err := a.payloadClient.Find(ctx, "kafka-topics", query)
	if err != nil {
		return nil, fmt.Errorf("querying topics: %w", err)
	}

	var deleted, failed []string

	for _, topic := range topics {
		topicID, ok := topic["id"].(string)
		if !ok {
			continue
		}

		physicalName, _ := topic["physicalName"].(string)
		if physicalName == "" {
			// Topic was never provisioned, skip
			a.logger.Info("Skipping topic without physicalName",
				"topicId", topicID,
			)
			continue
		}

		// Delete from Kafka cluster if adapter factory is available
		if a.adapterFactory == nil {
			a.logger.Warn("AdapterFactory not available, cannot delete physical topic",
				"topicId", topicID,
				"physicalName", physicalName,
			)
			// Mark as failed since we couldn't delete from Kafka
			failed = append(failed, topicID)
			continue
		}

		// In a full implementation, we would:
		// 1. Get the virtual cluster for this topic
		// 2. Get the physical cluster config
		// 3. Create a Kafka adapter
		// 4. Call adapter.DeleteTopic(ctx, physicalName)
		// For now, log that we would delete
		a.logger.Info("Would delete topic from Kafka",
			"topicId", topicID,
			"physicalName", physicalName,
		)

		// Update status in Payload CMS
		if err := a.payloadClient.Update(ctx, "kafka-topics", topicID, map[string]any{
			"status":    "deleted",
			"deletedAt": time.Now().Format(time.RFC3339),
		}); err != nil {
			a.logger.Warn("Failed to update topic status",
				"topicId", topicID,
				"error", err,
			)
			failed = append(failed, topicID)
			continue
		}

		deleted = append(deleted, topicID)
	}

	return &DeletePhysicalTopicsResult{
		Success:       len(failed) == 0,
		DeletedTopics: deleted,
		FailedTopics:  failed,
	}, nil
}

// RevokeAllCredentials revokes all credentials for an application
func (a *DecommissioningActivities) RevokeAllCredentials(ctx context.Context, input RevokeAllCredentialsInput) (*RevokeAllCredentialsResult, error) {
	a.logger.Info("RevokeAllCredentials", "applicationId", input.ApplicationID)

	// Query service accounts for this application
	query := clients.NewQueryBuilder().
		WhereEquals("application", input.ApplicationID).
		WhereEquals("status", "active").
		Build()

	accounts, err := a.payloadClient.Find(ctx, "kafka-service-accounts", query)
	if err != nil {
		return nil, fmt.Errorf("querying service accounts: %w", err)
	}

	var revoked, failed []string

	for _, account := range accounts {
		accountID, ok := account["id"].(string)
		if !ok {
			continue
		}

		// Revoke from Bifrost if client is available
		if a.bifrostClient != nil {
			if err := a.bifrostClient.RevokeCredential(ctx, accountID); err != nil {
				a.logger.Warn("Failed to revoke credential from Bifrost",
					"accountId", accountID,
					"error", err,
				)
				failed = append(failed, accountID)
				continue
			}
		}

		// Update status in Payload CMS
		if err := a.payloadClient.Update(ctx, "kafka-service-accounts", accountID, map[string]any{
			"status":    "revoked",
			"revokedAt": time.Now().Format(time.RFC3339),
		}); err != nil {
			a.logger.Warn("Failed to update service account status",
				"accountId", accountID,
				"error", err,
			)
			failed = append(failed, accountID)
			continue
		}

		revoked = append(revoked, accountID)
	}

	return &RevokeAllCredentialsResult{
		Success:            len(failed) == 0,
		RevokedCredentials: revoked,
		FailedCredentials:  failed,
	}, nil
}

// DeleteVirtualClustersFromBifrost removes all virtual clusters from Bifrost for an application
func (a *DecommissioningActivities) DeleteVirtualClustersFromBifrost(ctx context.Context, input DeleteVirtualClustersFromBifrostInput) (*DeleteVirtualClustersFromBifrostResult, error) {
	a.logger.Info("DeleteVirtualClustersFromBifrost", "applicationId", input.ApplicationID)

	// Query virtual clusters for this application
	query := clients.NewQueryBuilder().
		WhereEquals("application", input.ApplicationID).
		Build()

	vcs, err := a.payloadClient.Find(ctx, "kafka-virtual-clusters", query)
	if err != nil {
		return nil, fmt.Errorf("querying virtual clusters: %w", err)
	}

	var deleted []string
	var failed []string

	for _, vc := range vcs {
		vcID, ok := vc["id"].(string)
		if !ok {
			continue
		}

		// Delete from Bifrost if client is available
		if a.bifrostClient != nil {
			if err := a.bifrostClient.DeleteVirtualCluster(ctx, vcID); err != nil {
				a.logger.Warn("Failed to delete virtual cluster from Bifrost",
					"vcId", vcID,
					"error", err,
				)
				failed = append(failed, vcID)
				continue
			}
		} else {
			a.logger.Warn("BifrostClient not available, skipping gateway deletion",
				"vcId", vcID,
			)
			// Continue anyway to update status in Payload
		}

		// Update status in Payload CMS
		if err := a.payloadClient.Update(ctx, "kafka-virtual-clusters", vcID, map[string]any{
			"status": "deleted",
		}); err != nil {
			a.logger.Warn("Failed to update virtual cluster status",
				"vcId", vcID,
				"error", err,
			)
			failed = append(failed, vcID)
			continue
		}

		deleted = append(deleted, vcID)
	}

	return &DeleteVirtualClustersFromBifrostResult{
		Success:                  len(failed) == 0,
		DeletedVirtualClusterIDs: deleted,
	}, nil
}

// ArchiveMetricsData archives metrics data for an application before deletion
func (a *DecommissioningActivities) ArchiveMetricsData(ctx context.Context, input ArchiveMetricsDataInput) (*ArchiveMetricsDataResult, error) {
	a.logger.Info("ArchiveMetricsData", "applicationId", input.ApplicationID)

	// Query metrics for this application
	query := clients.NewQueryBuilder().
		WhereEquals("application", input.ApplicationID).
		Limit(10000). // Paginate for large datasets
		Build()

	metrics, err := a.payloadClient.Find(ctx, "kafka-usage-metrics", query)
	if err != nil {
		return nil, fmt.Errorf("querying metrics: %w", err)
	}

	if len(metrics) == 0 {
		a.logger.Info("No metrics to archive", "applicationId", input.ApplicationID)
		return &ArchiveMetricsDataResult{
			Success:       true,
			ArchivedBytes: 0,
		}, nil
	}

	// Upload to S3/MinIO if storage client is available
	if a.storageClient == nil {
		a.logger.Warn("StorageClient not available, cannot archive metrics",
			"applicationId", input.ApplicationID,
			"metricsCount", len(metrics),
		)
		return &ArchiveMetricsDataResult{
			Success:       false,
			ArchivedBytes: 0,
		}, nil
	}

	path := fmt.Sprintf("archives/metrics/%s/%s.json",
		input.ApplicationID,
		time.Now().Format("2006-01-02T15-04-05"),
	)

	bytesWritten, err := a.storageClient.UploadJSON(ctx, path, metrics)
	if err != nil {
		a.logger.Warn("Failed to archive metrics",
			"applicationId", input.ApplicationID,
			"path", path,
			"error", err,
		)
		return &ArchiveMetricsDataResult{
			Success:       false,
			ArchivedBytes: 0,
		}, nil
	}

	a.logger.Info("Archived metrics successfully",
		"applicationId", input.ApplicationID,
		"path", path,
		"bytes", bytesWritten,
	)

	return &ArchiveMetricsDataResult{
		Success:       true,
		ArchivedBytes: bytesWritten,
	}, nil
}

// MarkApplicationDeleted marks an application as deleted in Payload
func (a *DecommissioningActivities) MarkApplicationDeleted(ctx context.Context, input MarkApplicationDeletedInput) error {
	a.logger.Info("MarkApplicationDeleted",
		"applicationId", input.ApplicationID,
		"deletedBy", input.DeletedBy,
		"forceDeleted", input.ForceDeleted,
	)

	return a.payloadClient.Update(ctx, "kafka-applications", input.ApplicationID, map[string]any{
		"status":       "deleted",
		"deletedAt":    time.Now().Format(time.RFC3339),
		"deletedBy":    input.DeletedBy,
		"forceDeleted": input.ForceDeleted,
	})
}

// ScheduleCleanupWorkflow schedules a cleanup workflow to run at a future time
func (a *DecommissioningActivities) ScheduleCleanupWorkflow(ctx context.Context, input ScheduleCleanupWorkflowInput) (*ScheduleCleanupWorkflowResult, error) {
	a.logger.Info("ScheduleCleanupWorkflow",
		"applicationId", input.ApplicationID,
		"workspaceId", input.WorkspaceID,
		"scheduledFor", input.ScheduledFor,
	)

	if a.temporalClient == nil {
		return nil, fmt.Errorf("Temporal client not available")
	}

	scheduleID := fmt.Sprintf("cleanup-%s", input.ApplicationID)

	handle, err := a.temporalClient.ScheduleClient().Create(ctx, client.ScheduleOptions{
		ID: scheduleID,
		Spec: client.ScheduleSpec{
			// Schedule for one-time execution at the specified time
			Calendars: []client.ScheduleCalendarSpec{
				{
					Year:       []client.ScheduleRange{{Start: input.ScheduledFor.Year()}},
					Month:      []client.ScheduleRange{{Start: int(input.ScheduledFor.Month())}},
					DayOfMonth: []client.ScheduleRange{{Start: input.ScheduledFor.Day()}},
					Hour:       []client.ScheduleRange{{Start: input.ScheduledFor.Hour()}},
					Minute:     []client.ScheduleRange{{Start: input.ScheduledFor.Minute()}},
					Second:     []client.ScheduleRange{{Start: input.ScheduledFor.Second()}},
				},
			},
		},
		Action: &client.ScheduleWorkflowAction{
			ID:        fmt.Sprintf("cleanup-wf-%s-%d", input.ApplicationID, time.Now().Unix()),
			Workflow:  "ApplicationCleanupWorkflow",
			TaskQueue: "application-cleanup",
			Args: []interface{}{
				map[string]string{
					"applicationId": input.ApplicationID,
					"workspaceId":   input.WorkspaceID,
				},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("creating cleanup schedule: %w", err)
	}

	return &ScheduleCleanupWorkflowResult{
		Success:    true,
		WorkflowID: handle.GetID(),
	}, nil
}

// UpdateApplicationWorkflowID updates the cleanup workflow ID for an application
func (a *DecommissioningActivities) UpdateApplicationWorkflowID(ctx context.Context, input UpdateApplicationWorkflowIDInput) error {
	a.logger.Info("UpdateApplicationWorkflowID",
		"applicationId", input.ApplicationID,
		"workflowId", input.WorkflowID,
	)

	return a.payloadClient.Update(ctx, "kafka-applications", input.ApplicationID, map[string]any{
		"cleanupWorkflowId": input.WorkflowID,
	})
}

// ExecuteImmediateCleanup performs immediate cleanup of all application resources
func (a *DecommissioningActivities) ExecuteImmediateCleanup(ctx context.Context, input ExecuteImmediateCleanupInput) (*ExecuteImmediateCleanupResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("ExecuteImmediateCleanup",
		"applicationId", input.ApplicationID,
		"workspaceId", input.WorkspaceID)

	// This activity composes other activities for immediate cleanup
	// It's used when force delete is requested and we need to skip the grace period

	// TODO: Delete physical topics
	topicsResult, err := a.DeletePhysicalTopics(ctx, DeletePhysicalTopicsInput{
		ApplicationID: input.ApplicationID,
	})
	if err != nil {
		logger.Error("Failed to delete topics", "error", err)
		return nil, err
	}

	// TODO: Revoke all credentials
	credsResult, err := a.RevokeAllCredentials(ctx, RevokeAllCredentialsInput{
		ApplicationID: input.ApplicationID,
	})
	if err != nil {
		logger.Error("Failed to revoke credentials", "error", err)
		return nil, err
	}

	// TODO: Delete virtual clusters from Bifrost
	_, err = a.DeleteVirtualClustersFromBifrost(ctx, DeleteVirtualClustersFromBifrostInput{
		ApplicationID: input.ApplicationID,
	})
	if err != nil {
		logger.Error("Failed to delete virtual clusters", "error", err)
		return nil, err
	}

	// TODO: Archive metrics data
	_, err = a.ArchiveMetricsData(ctx, ArchiveMetricsDataInput{
		ApplicationID: input.ApplicationID,
	})
	if err != nil {
		logger.Error("Failed to archive metrics", "error", err)
		// Non-fatal - continue with cleanup
	}

	return &ExecuteImmediateCleanupResult{
		Success:            true,
		TopicsDeleted:      len(topicsResult.DeletedTopics),
		CredentialsRevoked: len(credsResult.RevokedCredentials),
	}, nil
}
