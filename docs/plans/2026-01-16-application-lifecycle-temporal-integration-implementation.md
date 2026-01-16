# Application Lifecycle Temporal Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the Application Lifecycle server actions to decommissioning Temporal workflows

**Architecture:** Add helper functions to trigger workflows and cancel schedules, then integrate into existing server actions

**Tech Stack:** TypeScript, Next.js Server Actions, Temporal SDK (@temporalio/client)

---

### Task 1: Add Workflow Input Types and Helper Functions

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts:1-14`

**Step 1: Add import for getTemporalClient**

Add after line 6 (after `import { headers } from 'next/headers'`):

```typescript
import { getTemporalClient } from '@/lib/temporal/client'
```

**Step 2: Add workflow input type after KafkaApplicationWithLifecycle interface (after line 28)**

```typescript
/**
 * Workflow input type matching Go ApplicationDecommissioningInput struct.
 * Field names use PascalCase to match Go JSON tags.
 */
type ApplicationDecommissioningWorkflowInput = {
  ApplicationID: string
  WorkspaceID: string
  GracePeriodEndsAt: string // ISO8601 timestamp
  ForceDelete: boolean
  Reason?: string
}
```

**Step 3: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): add workflow input types for decommissioning"
```

---

### Task 2: Add triggerDecommissioningWorkflow Helper Function

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts`

**Step 1: Add helper function before the Server Actions section (around line 115, before `// ============================================================================`)**

```typescript
/**
 * Trigger the ApplicationDecommissioningWorkflow in Temporal.
 *
 * @param applicationId - Application ID (used for workflow ID)
 * @param input - Workflow input matching Go struct
 * @returns Workflow ID if started successfully, null otherwise
 */
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

    console.log(
      `[Kafka] Started ApplicationDecommissioningWorkflow: ${handle.workflowId} for application ${applicationId}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start ApplicationDecommissioningWorkflow:', error)
    return null
  }
}
```

**Step 2: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): add triggerDecommissioningWorkflow helper function"
```

---

### Task 3: Add cancelCleanupSchedule Helper Function

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts`

**Step 1: Add helper function after triggerDecommissioningWorkflow**

```typescript
/**
 * Cancel a scheduled cleanup workflow by deleting the Temporal schedule.
 *
 * @param applicationId - Application ID (schedule ID is `cleanup-{applicationId}`)
 * @returns true if schedule was deleted, false if it didn't exist or deletion failed
 */
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

**Step 2: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): add cancelCleanupSchedule helper function"
```

---

### Task 4: Update KafkaApplicationWithLifecycle Interface

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts:23-28`

**Step 1: Add decommissionWorkflowId field to interface**

Update the interface to add the new field:

```typescript
interface KafkaApplicationWithLifecycle extends KafkaApplication {
  gracePeriodEndsAt?: string | null
  gracePeriodDaysOverride?: number | null
  cleanupWorkflowId?: string | null
  decommissionWorkflowId?: string | null  // NEW: Track the main decommissioning workflow
  decommissionReason?: string | null
}
```

**Step 2: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): add decommissionWorkflowId to lifecycle interface"
```

---

### Task 5: Wire decommissionApplication to Temporal Workflow

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts` (lines 234-237)

**Step 1: Replace TODO comment with workflow trigger**

Find and replace the TODO at line 236:

```typescript
    // TODO: Trigger Temporal workflow for scheduled cleanup after grace period
```

Replace with:

```typescript
    // Trigger decommissioning workflow to set up cleanup schedule
    const workflowId = await triggerDecommissioningWorkflow(input.applicationId, {
      ApplicationID: input.applicationId,
      WorkspaceID: accessCheck.workspaceId!,
      GracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
      ForceDelete: false,
      Reason: input.reason,
    })

    // Store workflow ID on application for tracking
    if (workflowId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

**Step 2: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): wire decommissionApplication to Temporal workflow"
```

---

### Task 6: Wire cancelDecommissioning to Cancel Schedule

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts` (lines 351-354)

**Step 1: Replace TODO comment with schedule cancellation**

Find and replace the TODO at line 353:

```typescript
    // TODO: Cancel Temporal cleanup workflow if one was started
```

Replace with:

```typescript
    // Cancel the scheduled cleanup workflow if one exists
    if (app.cleanupWorkflowId) {
      await cancelCleanupSchedule(applicationId)
    }
```

**Step 2: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): wire cancelDecommissioning to cancel Temporal schedule"
```

---

### Task 7: Wire forceDeleteApplication to Temporal Workflow

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-application-lifecycle.ts` (lines 485-489)

**Step 1: Replace TODO comments with workflow trigger**

Find and replace the TODOs at lines 487-488:

```typescript
    // TODO: Cancel any active Temporal workflows for this application
    // TODO: Trigger cleanup workflow to remove physical resources
```

Replace with:

```typescript
    // Cancel any existing cleanup schedule (if application was already decommissioning)
    await cancelCleanupSchedule(applicationId)

    // Trigger immediate cleanup workflow with ForceDelete=true
    const workflowId = await triggerDecommissioningWorkflow(applicationId, {
      ApplicationID: applicationId,
      WorkspaceID: accessCheck.workspaceId!,
      GracePeriodEndsAt: new Date().toISOString(), // Immediate
      ForceDelete: true,
      Reason: reason || app.decommissionReason || 'Force deleted',
    })

    // Store workflow ID for tracking
    if (workflowId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

**Step 2: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(kafka): wire forceDeleteApplication to Temporal workflow"
```

---

### Task 8: Run Full Build and Test

**Files:**
- Test: `orbit-www/`

**Step 1: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

**Step 2: Run ESLint**

Run: `cd orbit-www && pnpm lint`
Expected: PASS (no errors)

**Step 3: Commit (squash if needed)**

If any lint fixes were needed:

```bash
git add orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "fix(kafka): lint fixes for application lifecycle"
```

---

### Task 9: Update TODO.md

**Files:**
- Modify: `docs/TODO.md`

**Step 1: Mark Application Lifecycle server actions as completed**

Find the section "Server Action Temporal Integration" and update:

```markdown
#### Application Lifecycle (Decommissioning activities now implemented)
- [x] `kafka-application-lifecycle.ts` - Wire server actions to decommissioning workflows (lines 236, 353, 487-488)
```

**Step 2: Update Last Updated date**

Change: `**Last Updated:** 2026-01-16 (Decommissioning Activities Implementation completed)`
To: `**Last Updated:** 2026-01-16 (Application Lifecycle Temporal Integration completed)`

**Step 3: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: mark Application Lifecycle Temporal integration as completed"
```
