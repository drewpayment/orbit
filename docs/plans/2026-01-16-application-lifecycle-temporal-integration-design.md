# Application Lifecycle Server Actions Temporal Integration Design

**Date:** 2026-01-16
**Status:** Ready for Implementation
**Author:** Claude (brainstorming session)

## Overview

Wire the Application Lifecycle server actions in `kafka-application-lifecycle.ts` to the decommissioning Temporal workflows that were just implemented. This connects the UI actions to the durable workflow orchestration.

## Current State

The `kafka-application-lifecycle.ts` file has 3 server actions with TODO comments:

1. **`decommissionApplication()`** (line 236) - `// TODO: Trigger Temporal workflow for scheduled cleanup after grace period`
2. **`cancelDecommissioning()`** (line 353) - `// TODO: Cancel Temporal cleanup workflow if one was started`
3. **`forceDeleteApplication()`** (lines 487-488) - `// TODO: Cancel any active Temporal workflows` and `// TODO: Trigger cleanup workflow`

## Design Decisions

### 1. Workflow Task Queue

The `ApplicationDecommissioningWorkflow` uses `"application-decommissioning"` task queue (defined in `application_decommissioning_workflow.go:13`), but the worker in `cmd/worker/main.go` registers the workflow on `"orbit-workflows"` (line 147).

**Decision:** Use `"orbit-workflows"` task queue for consistency with other workflows. This is the task queue where the workflow is registered.

### 2. Workflow Input Mapping

Go workflow expects `ApplicationDecommissioningInput` with these fields:
- `ApplicationID` (string)
- `WorkspaceID` (string)
- `GracePeriodEndsAt` (time.Time - ISO8601 string from TypeScript)
- `ForceDelete` (bool)
- `Reason` (string, optional)

TypeScript needs to map camelCase to PascalCase JSON tags (matching Go struct tags).

### 3. Cancel Workflow Approach

To cancel a decommissioning, we need to:
1. Cancel the scheduled Temporal schedule (not a running workflow)
2. The `ScheduleCleanupWorkflow` activity creates a schedule with ID `cleanup-{applicationId}`

**Decision:** Use Temporal Schedule API to delete the schedule, not workflow cancellation.

### 4. Force Delete Handling

For force delete:
1. Cancel any existing cleanup schedule (if application was already decommissioning)
2. Trigger `ApplicationDecommissioningWorkflow` with `ForceDelete: true`

## Implementation Details

### Add Workflow Trigger Function

```typescript
import { getTemporalClient } from '@/lib/temporal/client'

type ApplicationDecommissioningWorkflowInput = {
  ApplicationID: string
  WorkspaceID: string
  GracePeriodEndsAt: string // ISO8601 timestamp
  ForceDelete: boolean
  Reason?: string
}

async function triggerDecommissioningWorkflow(
  applicationId: string,
  input: ApplicationDecommissioningWorkflowInput
): Promise<string | null> {
  const workflowId = `app-decommission-${applicationId}`

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('ApplicationDecommissioningWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [input],
    })

    console.log(`[Kafka] Started ApplicationDecommissioningWorkflow: ${handle.workflowId}`)
    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start ApplicationDecommissioningWorkflow:', error)
    return null
  }
}
```

### Add Schedule Cancellation Function

```typescript
async function cancelCleanupSchedule(applicationId: string): Promise<boolean> {
  const scheduleId = `cleanup-${applicationId}`

  try {
    const client = await getTemporalClient()
    const scheduleHandle = client.schedule.getHandle(scheduleId)
    await scheduleHandle.delete()
    console.log(`[Kafka] Deleted cleanup schedule: ${scheduleId}`)
    return true
  } catch (error) {
    // Schedule may not exist, which is fine
    console.log(`[Kafka] Could not delete schedule ${scheduleId}:`, error)
    return false
  }
}
```

### Update decommissionApplication()

After line 234 (after setting VCs to read_only), add:

```typescript
// Trigger decommissioning workflow
const workflowId = await triggerDecommissioningWorkflow(input.applicationId, {
  ApplicationID: input.applicationId,
  WorkspaceID: accessCheck.workspaceId!,
  GracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
  ForceDelete: false,
  Reason: input.reason,
})

// Store workflow ID on application
if (workflowId) {
  await payload.update({
    collection: 'kafka-applications',
    id: input.applicationId,
    data: {
      decommissionWorkflowId: workflowId,
    } as any,
    overrideAccess: true,
  })
}
```

### Update cancelDecommissioning()

After line 351 (after updating application status), add:

```typescript
// Cancel the scheduled cleanup workflow
if (app.cleanupWorkflowId) {
  await cancelCleanupSchedule(applicationId)
}
```

### Update forceDeleteApplication()

After line 485 (after marking application as deleted), add:

```typescript
// Cancel any existing cleanup schedule
await cancelCleanupSchedule(applicationId)

// Trigger immediate cleanup workflow
const workflowId = await triggerDecommissioningWorkflow(applicationId, {
  ApplicationID: applicationId,
  WorkspaceID: accessCheck.workspaceId!,
  GracePeriodEndsAt: new Date().toISOString(), // Immediate
  ForceDelete: true,
  Reason: reason || app.decommissionReason || 'Force deleted',
})

// Store workflow ID
if (workflowId) {
  await payload.update({
    collection: 'kafka-applications',
    id: applicationId,
    data: {
      decommissionWorkflowId: workflowId,
    } as any,
    overrideAccess: true,
  })
}
```

## Files to Modify

1. **`orbit-www/src/app/actions/kafka-application-lifecycle.ts`**
   - Add import for `getTemporalClient`
   - Add `ApplicationDecommissioningWorkflowInput` type
   - Add `triggerDecommissioningWorkflow()` helper function
   - Add `cancelCleanupSchedule()` helper function
   - Update `decommissionApplication()` to trigger workflow
   - Update `cancelDecommissioning()` to cancel schedule
   - Update `forceDeleteApplication()` to cancel schedule and trigger workflow

2. **`orbit-www/src/components/features/workspace/kafka/`** (optional)
   - May need to add `decommissionWorkflowId` to interface types if not already present

## Testing Strategy

### Unit Tests
- Mock `getTemporalClient()` to verify workflow is started with correct args
- Test error handling when workflow fails to start
- Test schedule cancellation error handling

### Integration Tests
- Start decommissioning and verify workflow is triggered
- Cancel decommissioning and verify schedule is deleted
- Force delete and verify immediate cleanup workflow is triggered

## Notes

- The `KafkaApplicationWithLifecycle` interface already has `cleanupWorkflowId` field
- Need to add `decommissionWorkflowId` field for tracking the main decommissioning workflow
- Worker must be running with `ApplicationDecommissioningWorkflow` registered
