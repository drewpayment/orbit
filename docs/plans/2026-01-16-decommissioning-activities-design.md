# Decommissioning Activities Implementation Design

**Date:** 2026-01-16
**Status:** Ready for Implementation
**Author:** Claude (brainstorming session)

## Overview

Implement the 10 Temporal activities in `temporal-workflows/internal/activities/decommissioning_activities.go` that currently return mock/placeholder results. These activities support the `ApplicationDecommissioningWorkflow` and `ApplicationCleanupWorkflow` for Kafka application lifecycle management.

## Current State

The following activities exist with placeholder implementations:
1. `SetVirtualClustersReadOnly` - Sets VCs to read-only in Bifrost
2. `CheckApplicationStatus` - Verifies application can proceed with decommissioning
3. `DeletePhysicalTopics` - Deletes Kafka topics from clusters
4. `RevokeAllCredentials` - Revokes service account credentials from Bifrost
5. `DeleteVirtualClustersFromBifrost` - Removes VCs from Bifrost gateway
6. `ArchiveMetricsData` - Archives usage metrics to S3/MinIO
7. `MarkApplicationDeleted` - Updates application status in Payload CMS
8. `ScheduleCleanupWorkflow` - Creates Temporal schedule for cleanup
9. `UpdateApplicationWorkflowID` - Records workflow ID in application
10. `ExecuteImmediateCleanup` - Orchestrates immediate cleanup (already implemented, calls others)

## Design Decisions

### 1. Struct Refactoring

Refactor `DecommissioningActivities` to use client instances instead of URLs:

```go
type DecommissioningActivities struct {
    payloadClient  *clients.PayloadClient
    bifrostClient  *clients.BifrostClient
    adapterFactory *clients.KafkaAdapterFactory
    storageClient  *clients.StorageClient   // NEW
    temporalClient client.Client            // For schedules
    logger         *slog.Logger
}
```

This matches the established pattern in `KafkaActivitiesImpl`.

### 2. New Storage Client

Create `internal/clients/storage_client.go` for MinIO/S3 operations:

```go
type StorageClient struct {
    client *minio.Client
    bucket string
    logger *slog.Logger
}

// Methods:
func NewStorageClient(endpoint, accessKey, secretKey, bucket string, useSSL bool, logger *slog.Logger) (*StorageClient, error)
func (c *StorageClient) UploadJSON(ctx context.Context, path string, data any) (int64, error)
```

### 3. Error Handling Strategy

**Critical activities** (must succeed):
- `CheckApplicationStatus` - Can't proceed without status verification
- `MarkApplicationDeleted` - Final state must be recorded

**Best-effort activities** (partial success OK):
- `SetVirtualClustersReadOnly` - Continue even if some VCs fail
- `DeletePhysicalTopics` - Track failed topics, continue with others
- `RevokeAllCredentials` - Track failed credentials, continue
- `DeleteVirtualClustersFromBifrost` - Track failed VCs, continue
- `ArchiveMetricsData` - Non-fatal if archiving fails

Results include both success and failure lists for auditability.

## Implementation Details

### SetVirtualClustersReadOnly

```go
func (a *DecommissioningActivities) SetVirtualClustersReadOnly(ctx context.Context, input SetVirtualClustersReadOnlyInput) (*SetVirtualClustersReadOnlyResult, error) {
    // 1. Query Payload for virtual clusters
    query := clients.NewQueryBuilder().
        WhereEquals("application", input.ApplicationID).
        Build()
    vcs, err := a.payloadClient.Find(ctx, "kafka-virtual-clusters", query)

    // 2. For each VC, call Bifrost SetVirtualClusterReadOnly
    var updated []string
    for _, vc := range vcs {
        vcID := vc["id"].(string)
        err := a.bifrostClient.SetVirtualClusterReadOnly(ctx, vcID, input.ReadOnly)
        if err == nil {
            updated = append(updated, vcID)
        }
    }

    // 3. Return results
    return &SetVirtualClustersReadOnlyResult{
        Success: len(updated) == len(vcs),
        UpdatedVirtualClusterIDs: updated,
    }, nil
}
```

### CheckApplicationStatus

```go
func (a *DecommissioningActivities) CheckApplicationStatus(ctx context.Context, input CheckApplicationStatusInput) (*CheckApplicationStatusResult, error) {
    // 1. Get application from Payload
    app, err := a.payloadClient.Get(ctx, "kafka-applications", input.ApplicationID)

    // 2. Check status
    status := app["status"].(string)
    canProceed := status == "decommissioning"

    return &CheckApplicationStatusResult{
        Status: status,
        CanProceed: canProceed,
    }, nil
}
```

### DeletePhysicalTopics

```go
func (a *DecommissioningActivities) DeletePhysicalTopics(ctx context.Context, input DeletePhysicalTopicsInput) (*DeletePhysicalTopicsResult, error) {
    // 1. Query topics for this application
    query := clients.NewQueryBuilder().
        WhereEquals("application", input.ApplicationID).
        Build()
    topics, err := a.payloadClient.Find(ctx, "kafka-topics", query)

    // 2. For each topic with physicalName
    var deleted, failed []string
    for _, topic := range topics {
        physicalName := topic["physicalName"].(string)
        if physicalName == "" {
            continue
        }

        // Get cluster config (via virtual cluster chain)
        // Create Kafka adapter
        // Delete topic
        // Update status in Payload
    }

    return &DeletePhysicalTopicsResult{
        Success: len(failed) == 0,
        DeletedTopics: deleted,
        FailedTopics: failed,
    }, nil
}
```

### RevokeAllCredentials

```go
func (a *DecommissioningActivities) RevokeAllCredentials(ctx context.Context, input RevokeAllCredentialsInput) (*RevokeAllCredentialsResult, error) {
    // 1. Query service accounts for this application
    query := clients.NewQueryBuilder().
        WhereEquals("application", input.ApplicationID).
        WhereEquals("status", "active").
        Build()
    accounts, err := a.payloadClient.Find(ctx, "kafka-service-accounts", query)

    // 2. For each account, revoke from Bifrost
    var revoked, failed []string
    for _, account := range accounts {
        accountID := account["id"].(string)
        err := a.bifrostClient.RevokeCredential(ctx, accountID)
        if err != nil {
            failed = append(failed, accountID)
            continue
        }

        // Update status in Payload
        a.payloadClient.Update(ctx, "kafka-service-accounts", accountID, map[string]any{
            "status": "revoked",
            "revokedAt": time.Now().Format(time.RFC3339),
        })
        revoked = append(revoked, accountID)
    }

    return &RevokeAllCredentialsResult{
        Success: len(failed) == 0,
        RevokedCredentials: revoked,
        FailedCredentials: failed,
    }, nil
}
```

### DeleteVirtualClustersFromBifrost

```go
func (a *DecommissioningActivities) DeleteVirtualClustersFromBifrost(ctx context.Context, input DeleteVirtualClustersFromBifrostInput) (*DeleteVirtualClustersFromBifrostResult, error) {
    // 1. Query virtual clusters
    query := clients.NewQueryBuilder().
        WhereEquals("application", input.ApplicationID).
        Build()
    vcs, err := a.payloadClient.Find(ctx, "kafka-virtual-clusters", query)

    // 2. Delete from Bifrost and update Payload
    var deleted []string
    for _, vc := range vcs {
        vcID := vc["id"].(string)
        err := a.bifrostClient.DeleteVirtualCluster(ctx, vcID)
        if err == nil {
            a.payloadClient.Update(ctx, "kafka-virtual-clusters", vcID, map[string]any{
                "status": "deleted",
            })
            deleted = append(deleted, vcID)
        }
    }

    return &DeleteVirtualClustersFromBifrostResult{
        Success: len(deleted) == len(vcs),
        DeletedVirtualClusterIDs: deleted,
    }, nil
}
```

### ArchiveMetricsData

```go
func (a *DecommissioningActivities) ArchiveMetricsData(ctx context.Context, input ArchiveMetricsDataInput) (*ArchiveMetricsDataResult, error) {
    // 1. Query metrics for this application
    query := clients.NewQueryBuilder().
        WhereEquals("application", input.ApplicationID).
        Limit(10000). // Paginate for large datasets
        Build()
    metrics, err := a.payloadClient.Find(ctx, "kafka-usage-metrics", query)

    // 2. Upload to S3/MinIO
    path := fmt.Sprintf("archives/metrics/%s/%s.json",
        input.ApplicationID,
        time.Now().Format("2006-01-02T15-04-05"))
    bytesWritten, err := a.storageClient.UploadJSON(ctx, path, metrics)

    return &ArchiveMetricsDataResult{
        Success: err == nil,
        ArchivedBytes: bytesWritten,
    }, nil
}
```

### MarkApplicationDeleted

```go
func (a *DecommissioningActivities) MarkApplicationDeleted(ctx context.Context, input MarkApplicationDeletedInput) error {
    return a.payloadClient.Update(ctx, "kafka-applications", input.ApplicationID, map[string]any{
        "status":       "deleted",
        "deletedAt":    time.Now().Format(time.RFC3339),
        "deletedBy":    input.DeletedBy,
        "forceDeleted": input.ForceDeleted,
    })
}
```

### ScheduleCleanupWorkflow

```go
func (a *DecommissioningActivities) ScheduleCleanupWorkflow(ctx context.Context, input ScheduleCleanupWorkflowInput) (*ScheduleCleanupWorkflowResult, error) {
    scheduleID := fmt.Sprintf("cleanup-%s", input.ApplicationID)

    handle, err := a.temporalClient.ScheduleClient().Create(ctx, client.ScheduleOptions{
        ID: scheduleID,
        Spec: client.ScheduleSpec{
            StartAt: []time.Time{input.ScheduledFor},
        },
        Action: &client.ScheduleWorkflowAction{
            ID:        fmt.Sprintf("cleanup-wf-%s-%d", input.ApplicationID, time.Now().Unix()),
            Workflow:  "ApplicationCleanupWorkflow",
            TaskQueue: "application-cleanup",
            Args: []interface{}{
                workflows.ApplicationCleanupInput{
                    ApplicationID: input.ApplicationID,
                    WorkspaceID:   input.WorkspaceID,
                },
            },
        },
    })

    return &ScheduleCleanupWorkflowResult{
        Success:    true,
        WorkflowID: handle.GetID(),
    }, nil
}
```

### UpdateApplicationWorkflowID

```go
func (a *DecommissioningActivities) UpdateApplicationWorkflowID(ctx context.Context, input UpdateApplicationWorkflowIDInput) error {
    return a.payloadClient.Update(ctx, "kafka-applications", input.ApplicationID, map[string]any{
        "cleanupWorkflowId": input.WorkflowID,
    })
}
```

## Files to Create/Modify

### New Files

1. `temporal-workflows/internal/clients/storage_client.go`
   - MinIO/S3 client implementation
   - `NewStorageClient()` constructor
   - `UploadJSON()` method

2. `temporal-workflows/internal/clients/storage_client_test.go`
   - Unit tests with mocked MinIO client

### Modified Files

1. `temporal-workflows/internal/activities/decommissioning_activities.go`
   - Refactor struct to use client instances
   - Implement all 10 activities with real logic

2. `temporal-workflows/cmd/worker/main.go`
   - Add StorageClient initialization
   - Add Temporal client injection for schedules
   - Wire up new dependencies to DecommissioningActivities

3. `temporal-workflows/go.mod`
   - Add `github.com/minio/minio-go/v7` dependency

## Testing Strategy

### Unit Tests
- Mock `PayloadClient`, `BifrostClient`, `StorageClient`
- Test each activity in isolation
- Verify correct API calls and error handling

### Integration Tests (Future)
- Test against real Payload CMS
- Test against real Bifrost gateway
- Test Temporal schedule creation

## Configuration

New environment variables needed:

```bash
# MinIO/S3 configuration
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=orbit-archives
MINIO_USE_SSL=false
```

## Post-Implementation Review

After implementing the existing 10 activities, review the TODO.md list to identify any gaps:

TODO.md mentions:
- `CheckpointConsumerOffsets` - Not in current code
- `NotifyWorkspaceAdmins` - Not in current code
- `CreateAuditRecord` - Not in current code
- `RestoreConsumerOffsets` - Not in current code

These may need to be added as separate activities in a follow-up task.
