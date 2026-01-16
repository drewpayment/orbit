# Server Action Temporal Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire UI server actions to Temporal workflows for Schema validation/registration and Access provisioning/revocation

**Architecture:** Frontend server actions create records in Payload CMS, then start Temporal workflows using the existing `getTemporalClient()`. Workflows execute real Kafka/Schema Registry operations via Phase 2 activities.

**Tech Stack:** TypeScript (Next.js server actions), Temporal SDK, Go workflows/activities

---

## Task 1: Fix Workflow Task Queues

The schema and access workflows define dedicated task queues that don't match where the worker registers activities. Fix by changing to use `orbit-workflows`.

**Files:**
- Modify: `temporal-workflows/internal/workflows/kafka_schema_workflow.go:12-13`
- Modify: `temporal-workflows/internal/workflows/kafka_access_workflow.go:12-13`

**Step 1: Update schema workflow task queue**

Change in `kafka_schema_workflow.go`:

```go
const (
	// KafkaSchemaValidationTaskQueue is the task queue for schema validation workflows
	KafkaSchemaValidationTaskQueue = "orbit-workflows"
)
```

**Step 2: Update access workflow task queue**

Change in `kafka_access_workflow.go`:

```go
const (
	// KafkaAccessProvisioningTaskQueue is the task queue for access provisioning workflows
	KafkaAccessProvisioningTaskQueue = "orbit-workflows"
)
```

**Step 3: Verify build**

Run: `cd /Users/drew.payment/dev/orbit/temporal-workflows && go build ./...`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add temporal-workflows/internal/workflows/kafka_schema_workflow.go temporal-workflows/internal/workflows/kafka_access_workflow.go
git commit -m "fix(temporal): use orbit-workflows task queue for schema and access workflows"
```

---

## Task 2: Implement registerSchema Server Action

Replace the placeholder with real Temporal workflow trigger.

**Files:**
- Modify: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts:673-684`

**Step 1: Add Temporal client import**

At the top of the file (after other imports, around line 7), add:

```typescript
import { getTemporalClient } from '@/lib/temporal/client'
```

**Step 2: Replace registerSchema implementation**

Replace lines 673-684 with:

```typescript
export async function registerSchema(input: RegisterSchemaInput): Promise<RegisterSchemaResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  try {
    // 1. Fetch topic to get workspace ID
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: input.topicId,
      depth: 1,
      overrideAccess: true,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    const workspaceId = typeof topic.workspace === 'string'
      ? topic.workspace
      : topic.workspace.id

    // 2. Create schema record in Payload (status: pending)
    const schema = await payload.create({
      collection: 'kafka-schemas',
      data: {
        workspace: workspaceId,
        topic: input.topicId,
        type: input.type,
        format: input.format,
        content: input.content,
        compatibility: input.compatibility || 'backward',
        status: 'pending',
      },
      overrideAccess: true,
    })

    // 3. Start Temporal workflow
    const client = await getTemporalClient()
    const workflowId = `schema-validation-${schema.id}`

    await client.workflow.start('SchemaValidationWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [{
        SchemaID: schema.id,
        TopicID: input.topicId,
        WorkspaceID: workspaceId,
        Type: input.type,
        Format: input.format,
        Content: input.content,
        Compatibility: input.compatibility || 'backward',
        AutoRegister: true,
      }],
    })

    console.log(`[Kafka] Started SchemaValidationWorkflow: ${workflowId}`)

    // 4. Return success with schema info
    return {
      success: true,
      schema: {
        id: schema.id,
        subject: schema.subject || '',
        type: schema.type as 'key' | 'value',
        format: schema.format as 'avro' | 'protobuf' | 'json',
        version: schema.version || 0,
        content: schema.content,
        status: schema.status as 'pending' | 'registered' | 'failed',
      },
    }
  } catch (error) {
    console.error('[Kafka] Failed to register schema:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register schema',
    }
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/drew.payment/dev/orbit/orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts
git commit -m "feat(kafka): implement registerSchema server action with Temporal workflow"
```

---

## Task 3: Implement triggerShareApprovedWorkflow in kafka-topic-shares.ts

Replace the console.log placeholder with real Temporal workflow trigger.

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-topic-shares.ts:1-8` (add import)
- Modify: `orbit-www/src/app/actions/kafka-topic-shares.ts:131-142` (replace function)

**Step 1: Add Temporal client import**

After the existing imports (around line 7), add:

```typescript
import { getTemporalClient } from '@/lib/temporal/client'
```

**Step 2: Replace triggerShareApprovedWorkflow**

Replace lines 131-142 with:

```typescript
/**
 * Trigger workflow for approved share
 */
async function triggerShareApprovedWorkflow(
  share: {
    id: string
    topic: { id: string; name: string; physicalName?: string }
    targetWorkspace: { id: string }
    permission?: string
    expiresAt?: string | null
  }
): Promise<void> {
  const client = await getTemporalClient()
  const workflowId = `access-provision-${share.id}`

  await client.workflow.start('AccessProvisioningWorkflow', {
    taskQueue: 'orbit-workflows',
    workflowId,
    args: [{
      ShareID: share.id,
      TopicID: share.topic.id,
      TopicName: share.topic.physicalName || share.topic.name,
      WorkspaceID: share.targetWorkspace.id,
      Permission: share.permission || 'read',
      ExpiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : null,
    }],
  })

  console.log(`[Kafka] Started AccessProvisioningWorkflow: ${workflowId}`)
}
```

**Step 3: Update approveShare to pass full share data**

In the `approveShare` function (around line 239-247), update to pass more share data:

Find this code block:
```typescript
    // Get topic info for workflow
    const topic = typeof share.topic === 'string'
      ? { id: share.topic, name: 'Unknown' }
      : { id: share.topic.id, name: share.topic.name ?? 'Unknown' }

    // Trigger approval workflow
    await triggerShareApprovedWorkflow({
      id: share.id,
      topic,
    })
```

Replace with:
```typescript
    // Get topic info for workflow
    const topic = typeof share.topic === 'string'
      ? { id: share.topic, name: 'Unknown', physicalName: undefined }
      : { id: share.topic.id, name: share.topic.name ?? 'Unknown', physicalName: share.topic.physicalName }

    // Get target workspace info
    const targetWorkspace = typeof share.targetWorkspace === 'string'
      ? { id: share.targetWorkspace }
      : { id: share.targetWorkspace.id }

    // Trigger approval workflow
    await triggerShareApprovedWorkflow({
      id: share.id,
      topic,
      targetWorkspace,
      permission: share.accessLevel,
      expiresAt: share.expiresAt,
    })
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Users/drew.payment/dev/orbit/orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-shares.ts
git commit -m "feat(kafka): implement triggerShareApprovedWorkflow with Temporal"
```

---

## Task 4: Implement triggerShareRevokedWorkflow in kafka-topic-shares.ts

Replace the console.log placeholder with real Temporal workflow trigger.

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-topic-shares.ts:147-156` (replace function)

**Step 1: Replace triggerShareRevokedWorkflow**

Replace lines 147-156 (after the Task 3 changes, this will be around line 165) with:

```typescript
/**
 * Trigger workflow for revoked share
 */
async function triggerShareRevokedWorkflow(
  share: {
    id: string
    topic: { id: string }
    targetWorkspace: { id: string }
  }
): Promise<void> {
  const client = await getTemporalClient()
  const workflowId = `access-revoke-${share.id}`

  await client.workflow.start('AccessRevocationWorkflow', {
    taskQueue: 'orbit-workflows',
    workflowId,
    args: [{
      ShareID: share.id,
      TopicID: share.topic.id,
      WorkspaceID: share.targetWorkspace.id,
    }],
  })

  console.log(`[Kafka] Started AccessRevocationWorkflow: ${workflowId}`)
}
```

**Step 2: Update revokeShare to pass full share data**

In the `revokeShare` function (around line 417-425), update to pass more share data:

Find this code block:
```typescript
    // Get topic info for workflow
    const topic = typeof share.topic === 'string'
      ? { id: share.topic, name: 'Unknown' }
      : { id: share.topic.id, name: share.topic.name ?? 'Unknown' }

    // Trigger revoke workflow
    await triggerShareRevokedWorkflow({
      id: share.id,
      topic,
    })
```

Replace with:
```typescript
    // Get topic info for workflow
    const topic = typeof share.topic === 'string'
      ? { id: share.topic }
      : { id: share.topic.id }

    // Get target workspace info
    const targetWorkspace = typeof share.targetWorkspace === 'string'
      ? { id: share.targetWorkspace }
      : { id: share.targetWorkspace.id }

    // Trigger revoke workflow
    await triggerShareRevokedWorkflow({
      id: share.id,
      topic,
      targetWorkspace,
    })
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/drew.payment/dev/orbit/orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-shares.ts
git commit -m "feat(kafka): implement triggerShareRevokedWorkflow with Temporal"
```

---

## Task 5: Implement triggerShareApprovedWorkflow in kafka-topic-catalog.ts

Replace the console.log placeholder with real Temporal workflow trigger.

**Files:**
- Modify: `orbit-www/src/app/actions/kafka-topic-catalog.ts:1-7` (add import)
- Modify: `orbit-www/src/app/actions/kafka-topic-catalog.ts:128-133` (replace function)

**Step 1: Add Temporal client import**

After the existing imports (around line 7), add:

```typescript
import { getTemporalClient } from '@/lib/temporal/client'
```

**Step 2: Replace triggerShareApprovedWorkflow**

Replace lines 128-133 with:

```typescript
/**
 * Trigger workflow for approved share (auto-approval path)
 */
async function triggerShareApprovedWorkflow(shareId: string, topicId: string): Promise<void> {
  const payload = await getPayload({ config })

  // Fetch full share record to get all needed data
  const share = await payload.findByID({
    collection: 'kafka-topic-shares',
    id: shareId,
    depth: 2,
    overrideAccess: true,
  })

  if (!share) {
    throw new Error(`Share ${shareId} not found`)
  }

  // Get topic physical name
  const topic = typeof share.topic === 'string'
    ? await payload.findByID({ collection: 'kafka-topics', id: share.topic, overrideAccess: true })
    : share.topic

  const topicName = topic?.physicalName || topic?.name || ''

  // Get target workspace ID
  const targetWorkspaceId = typeof share.targetWorkspace === 'string'
    ? share.targetWorkspace
    : share.targetWorkspace.id

  const client = await getTemporalClient()
  const workflowId = `access-provision-${shareId}`

  await client.workflow.start('AccessProvisioningWorkflow', {
    taskQueue: 'orbit-workflows',
    workflowId,
    args: [{
      ShareID: shareId,
      TopicID: topicId,
      TopicName: topicName,
      WorkspaceID: targetWorkspaceId,
      Permission: share.accessLevel || 'read',
      ExpiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : null,
    }],
  })

  console.log(`[Kafka] Started AccessProvisioningWorkflow (auto-approved): ${workflowId}`)
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/drew.payment/dev/orbit/orbit-www && pnpm tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/kafka-topic-catalog.ts
git commit -m "feat(kafka): implement triggerShareApprovedWorkflow in catalog with Temporal"
```

---

## Task 6: Build Verification

Verify all changes compile and the full project builds.

**Step 1: Build Go workflows**

Run: `cd /Users/drew.payment/dev/orbit/temporal-workflows && go build ./...`
Expected: Build succeeds

**Step 2: Run Go tests**

Run: `cd /Users/drew.payment/dev/orbit/temporal-workflows && go test ./internal/workflows/...`
Expected: Tests pass

**Step 3: Build frontend**

Run: `cd /Users/drew.payment/dev/orbit/orbit-www && pnpm build`
Expected: Build succeeds (or only unrelated errors)

**Step 4: Commit final state**

If any adjustments were needed:
```bash
git add -A
git commit -m "fix: address build issues from server action integration"
```

---

## Task 7: Update TODO.md

Mark the completed server actions in the TODO file.

**Files:**
- Modify: `docs/TODO.md`

**Step 1: Update the Server Action Temporal Integration section**

Find the section "### High Priority - Server Action Temporal Integration" and update:

```markdown
### High Priority - Server Action Temporal Integration

**Status:** Schema and Access workflows wired to UI
**Location:** `orbit-www/src/app/actions/`

**Note:** Phase 2 completed real Kafka adapter implementations. Server actions now trigger the workflows.

#### Topic Operations (COMPLETED)
- [x] `kafka-topics.ts` - `triggerTopicProvisioningWorkflow`, `triggerTopicDeletionWorkflow` implemented

#### Schema Operations (COMPLETED)
- [x] `actions.ts` - `registerSchema` - Starts SchemaValidationWorkflow

#### Access/Share Operations (COMPLETED)
- [x] `kafka-topic-shares.ts` - `triggerShareApprovedWorkflow` - Starts AccessProvisioningWorkflow
- [x] `kafka-topic-shares.ts` - `triggerShareRevokedWorkflow` - Starts AccessRevocationWorkflow
- [x] `kafka-topic-catalog.ts` - `triggerShareApprovedWorkflow` (auto-approval path)

#### Service Account Operations (Need workflow + server action)
- [ ] `kafka-service-accounts.ts` - Temporal workflow triggers (lines 140, 202, 242)

#### Offset Recovery (Need workflow completion + server action)
- [ ] `kafka-offset-recovery.ts` - `executeOffsetRestore` returns placeholder (line 373)

#### Application Lifecycle (Decommissioning activities still stubbed)
- [ ] `kafka-application-lifecycle.ts` - Temporal workflow triggers (lines 236, 353, 487-488)
```

**Step 2: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: update TODO.md with completed server action integrations"
```

---

## Summary

After completing all tasks:

1. **Task 1**: Fixed workflow task queues to use `orbit-workflows`
2. **Task 2**: Implemented `registerSchema` server action
3. **Task 3**: Implemented `triggerShareApprovedWorkflow` in kafka-topic-shares.ts
4. **Task 4**: Implemented `triggerShareRevokedWorkflow` in kafka-topic-shares.ts
5. **Task 5**: Implemented `triggerShareApprovedWorkflow` in kafka-topic-catalog.ts
6. **Task 6**: Verified builds pass
7. **Task 7**: Updated TODO.md

**Testing the integration:**

1. Start dev environment: `make dev`
2. Create a topic in a workspace
3. Try registering a schema - verify workflow starts in Temporal UI (http://localhost:8080)
4. Try requesting topic access from another workspace
5. Approve the share - verify ACL workflow starts
6. Revoke the share - verify revocation workflow starts
