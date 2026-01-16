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
	logger := activity.GetLogger(ctx)
	logger.Info("SetVirtualClustersReadOnly",
		"applicationId", input.ApplicationID,
		"readOnly", input.ReadOnly)

	// TODO: Query Payload for virtual clusters associated with this application
	// GET /api/virtual-clusters?where[application][equals]={applicationId}
	//
	// TODO: For each virtual cluster, call Bifrost SetVirtualClusterReadOnly RPC
	// conn, err := grpc.Dial(a.bifrostURL, grpc.WithInsecure())
	// client := gatewayv1.NewBifrostAdminServiceClient(conn)
	// client.SetVirtualClusterReadOnly(ctx, &gatewayv1.SetVirtualClusterReadOnlyRequest{
	//     VirtualClusterId: vc.ID,
	//     ReadOnly: input.ReadOnly,
	// })
	//
	// TODO: Update virtual cluster status in Payload

	// Placeholder implementation - return mock success
	return &SetVirtualClustersReadOnlyResult{
		Success:                  true,
		UpdatedVirtualClusterIDs: []string{"mock-vc-1", "mock-vc-2"},
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
	logger := activity.GetLogger(ctx)
	logger.Info("DeletePhysicalTopics",
		"applicationId", input.ApplicationID)

	// TODO: Query Payload for topics associated with this application
	// GET /api/kafka-topics?where[application][equals]={applicationId}
	//
	// TODO: For each topic, delete from Kafka via admin client
	// adminClient, err := kafka.NewAdminClient(config)
	// adminClient.DeleteTopics(ctx, []string{topic.FullName})
	//
	// TODO: Update topic status in Payload to "deleted"
	// PATCH /api/kafka-topics/{topicId} { status: "deleted" }
	//
	// TODO: Track successful and failed deletions

	// Placeholder implementation - return mock success
	return &DeletePhysicalTopicsResult{
		Success:       true,
		DeletedTopics: []string{"mock-topic-1", "mock-topic-2"},
		FailedTopics:  []string{},
	}, nil
}

// RevokeAllCredentials revokes all credentials for an application
func (a *DecommissioningActivities) RevokeAllCredentials(ctx context.Context, input RevokeAllCredentialsInput) (*RevokeAllCredentialsResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("RevokeAllCredentials",
		"applicationId", input.ApplicationID)

	// TODO: Query Payload for service accounts associated with this application
	// GET /api/service-accounts?where[application][equals]={applicationId}
	//
	// TODO: For each service account, call Bifrost RevokeCredential RPC
	// conn, err := grpc.Dial(a.bifrostURL, grpc.WithInsecure())
	// client := gatewayv1.NewBifrostAdminServiceClient(conn)
	// client.RevokeCredential(ctx, &gatewayv1.RevokeCredentialRequest{
	//     CredentialId: sa.CredentialId,
	// })
	//
	// TODO: Update service account status in Payload to "revoked"
	// PATCH /api/service-accounts/{id} { status: "revoked" }
	//
	// TODO: Track successful and failed revocations

	// Placeholder implementation - return mock success
	return &RevokeAllCredentialsResult{
		Success:            true,
		RevokedCredentials: []string{"mock-cred-1", "mock-cred-2"},
		FailedCredentials:  []string{},
	}, nil
}

// DeleteVirtualClustersFromBifrost removes all virtual clusters from Bifrost for an application
func (a *DecommissioningActivities) DeleteVirtualClustersFromBifrost(ctx context.Context, input DeleteVirtualClustersFromBifrostInput) (*DeleteVirtualClustersFromBifrostResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("DeleteVirtualClustersFromBifrost",
		"applicationId", input.ApplicationID)

	// TODO: Query Payload for virtual clusters associated with this application
	// GET /api/virtual-clusters?where[application][equals]={applicationId}
	//
	// TODO: For each virtual cluster, call Bifrost DeleteVirtualCluster RPC
	// conn, err := grpc.Dial(a.bifrostURL, grpc.WithInsecure())
	// client := gatewayv1.NewBifrostAdminServiceClient(conn)
	// client.DeleteVirtualCluster(ctx, &gatewayv1.DeleteVirtualClusterRequest{
	//     VirtualClusterId: vc.ID,
	// })
	//
	// TODO: Update virtual cluster status in Payload to "deleted"
	// PATCH /api/virtual-clusters/{id} { status: "deleted" }

	// Placeholder implementation - return mock success
	return &DeleteVirtualClustersFromBifrostResult{
		Success:                  true,
		DeletedVirtualClusterIDs: []string{"mock-vc-1", "mock-vc-2"},
	}, nil
}

// ArchiveMetricsData archives metrics data for an application before deletion
func (a *DecommissioningActivities) ArchiveMetricsData(ctx context.Context, input ArchiveMetricsDataInput) (*ArchiveMetricsDataResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("ArchiveMetricsData",
		"applicationId", input.ApplicationID)

	// TODO: Query Payload for KafkaUsageMetrics associated with this application
	// GET /api/kafka-usage-metrics?where[application][equals]={applicationId}
	//
	// TODO: Export metrics to archive storage (S3/MinIO)
	// - Serialize metrics to JSON or Parquet format
	// - Upload to s3://orbit-archives/metrics/{applicationId}/{timestamp}
	// - Track total bytes archived
	//
	// TODO: Optionally delete metrics from Payload after archiving
	// DELETE /api/kafka-usage-metrics?where[application][equals]={applicationId}

	// Placeholder implementation - return mock success
	return &ArchiveMetricsDataResult{
		Success:       true,
		ArchivedBytes: 1024 * 1024, // 1MB placeholder
	}, nil
}

// MarkApplicationDeleted marks an application as deleted in Payload
func (a *DecommissioningActivities) MarkApplicationDeleted(ctx context.Context, input MarkApplicationDeletedInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("MarkApplicationDeleted",
		"applicationId", input.ApplicationID,
		"deletedBy", input.DeletedBy,
		"forceDeleted", input.ForceDeleted)

	// TODO: Update application status in Payload
	// PATCH /api/applications/{applicationId}
	// {
	//     status: "deleted",
	//     deletedAt: time.Now().Format(time.RFC3339),
	//     deletedBy: input.DeletedBy,
	//     forceDeleted: input.ForceDeleted
	// }
	//
	// TODO: Emit deletion event for audit trail
	// POST /api/audit-events
	// {
	//     type: "application.deleted",
	//     applicationId: input.ApplicationID,
	//     actor: input.DeletedBy,
	//     metadata: { forceDeleted: input.ForceDeleted }
	// }

	return nil
}

// ScheduleCleanupWorkflow schedules a cleanup workflow to run at a future time
func (a *DecommissioningActivities) ScheduleCleanupWorkflow(ctx context.Context, input ScheduleCleanupWorkflowInput) (*ScheduleCleanupWorkflowResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("ScheduleCleanupWorkflow",
		"applicationId", input.ApplicationID,
		"workspaceId", input.WorkspaceID,
		"scheduledFor", input.ScheduledFor)

	// TODO: Create Temporal schedule for ApplicationCleanupWorkflow
	// scheduleClient := temporal.NewScheduleClient(connection)
	// handle, err := scheduleClient.Create(ctx, temporal.ScheduleOptions{
	//     ID: "cleanup-" + input.ApplicationID,
	//     Spec: temporal.ScheduleSpec{
	//         StartAt: input.ScheduledFor,
	//     },
	//     Action: &temporal.ScheduleWorkflowAction{
	//         Workflow: "ApplicationCleanupWorkflow",
	//         Args: []interface{}{ApplicationCleanupWorkflowInput{
	//             ApplicationID: input.ApplicationID,
	//             WorkspaceID:   input.WorkspaceID,
	//         }},
	//     },
	// })
	//
	// workflowID := handle.GetID()

	// Placeholder implementation - return mock success
	workflowID := "scheduled-cleanup-" + input.ApplicationID
	return &ScheduleCleanupWorkflowResult{
		Success:    true,
		WorkflowID: workflowID,
	}, nil
}

// UpdateApplicationWorkflowID updates the cleanup workflow ID for an application
func (a *DecommissioningActivities) UpdateApplicationWorkflowID(ctx context.Context, input UpdateApplicationWorkflowIDInput) error {
	logger := activity.GetLogger(ctx)
	logger.Info("UpdateApplicationWorkflowID",
		"applicationId", input.ApplicationID,
		"workflowId", input.WorkflowID)

	// TODO: Update application's cleanupWorkflowId field in Payload
	// PATCH /api/applications/{applicationId}
	// {
	//     cleanupWorkflowId: input.WorkflowID
	// }

	return nil
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
