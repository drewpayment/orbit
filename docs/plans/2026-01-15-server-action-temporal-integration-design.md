# Server Action Temporal Integration Design

**Status:** DRAFT
**Date:** 2026-01-15
**Scope:** Wire UI server actions to Temporal workflows for Schema and Access operations

## 1. Overview

Phase 2 completed the real Kafka adapter implementations for activities. This design covers wiring the frontend server actions to trigger the existing Temporal workflows.

### Current State

| Component | Status |
|-----------|--------|
| `SchemaValidationWorkflow` | ✅ Implemented (`kafka_schema_workflow.go`) |
| `AccessProvisioningWorkflow` | ✅ Implemented (`kafka_access_workflow.go`) |
| `AccessRevocationWorkflow` | ✅ Implemented (`kafka_access_workflow.go`) |
| `ValidateSchema` activity | ✅ Real implementation (Schema Registry) |
| `RegisterSchema` activity | ✅ Real implementation (Schema Registry) |
| `ProvisionAccess` activity | ✅ Real implementation (Kafka ACLs) |
| `RevokeAccess` activity | ✅ Real implementation (Kafka ACLs) |
| Server action triggers | ❌ Placeholder stubs |

### Reference Documents

- **Original Design:** `docs/plans/2026-01-03-kafka-gateway-self-service-design.md` (Section 5: Topic Sharing Flow)
- **Activity Implementation:** `docs/plans/2026-01-13-temporal-activities-implementation-design.md`
- **Phase 2 Design:** `docs/plans/2026-01-15-temporal-activities-phase2-design.md`

---

## 2. Task Queue Configuration Issue

### Problem

The workflows define dedicated task queues that don't match where the worker registers activities:

| Workflow | Task Queue (in workflow file) | Worker Registration |
|----------|-------------------------------|---------------------|
| `TopicProvisioningWorkflow` | `orbit-workflows` | ✅ `orbit-workflows` |
| `SchemaValidationWorkflow` | `kafka-schema-validation` | ❌ Not registered |
| `AccessProvisioningWorkflow` | `kafka-access-provisioning` | ❌ Not registered |

### Solution

**Option A (Recommended): Change workflow task queues to `orbit-workflows`**

Rationale:
- All Kafka activities are already registered on `orbit-workflows`
- Simpler operational model (one task queue for all Kafka workflows)
- Matches the existing `TopicProvisioningWorkflow` pattern

**Implementation:**
```go
// kafka_schema_workflow.go - Change from:
const KafkaSchemaValidationTaskQueue = "kafka-schema-validation"

// To:
const KafkaSchemaValidationTaskQueue = "orbit-workflows"

// kafka_access_workflow.go - Change from:
const KafkaAccessProvisioningTaskQueue = "kafka-access-provisioning"

// To:
const KafkaAccessProvisioningTaskQueue = "orbit-workflows"
```

**Option B: Register activities on multiple task queues**

Would require worker changes to listen on multiple queues. More complex, not recommended for MVP.

---

## 3. Server Action Implementation

### 3.1 Schema Registration (`registerSchema`)

**File:** `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts`

**Current:** Returns `'Not implemented'`

**Input Type:**
```typescript
interface RegisterSchemaInput {
  topicId: string
  type: 'key' | 'value'
  format: 'avro' | 'protobuf' | 'json'
  content: string
  compatibility?: 'backward' | 'forward' | 'full' | 'none'
}
```

**Workflow Input (Go):**
```go
type SchemaValidationWorkflowInput struct {
  SchemaID      string
  TopicID       string
  WorkspaceID   string
  Type          string // "key" or "value"
  Format        string // "avro", "protobuf", "json"
  Content       string
  Compatibility string
  AutoRegister  bool
}
```

**Implementation:**
```typescript
export async function registerSchema(input: RegisterSchemaInput): Promise<RegisterSchemaResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  // 1. Fetch topic to get workspaceId
  const topic = await getPayload().findByID({
    collection: 'kafka-topics',
    id: input.topicId,
    depth: 1,
  })
  if (!topic) {
    return { success: false, error: 'Topic not found' }
  }

  // 2. Create schema record in Payload (status: pending)
  const schema = await getPayload().create({
    collection: 'kafka-schemas',
    data: {
      topic: input.topicId,
      type: input.type,
      format: input.format,
      content: input.content,
      compatibility: input.compatibility || 'backward',
      status: 'pending',
      createdBy: session.user.id,
    },
  })

  // 3. Start Temporal workflow
  const client = await getTemporalClient()
  const workflowId = `schema-validation-${schema.id}`

  try {
    await client.workflow.start('SchemaValidationWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [{
        SchemaID: schema.id,
        TopicID: input.topicId,
        WorkspaceID: typeof topic.workspace === 'string' ? topic.workspace : topic.workspace.id,
        Type: input.type,
        Format: input.format,
        Content: input.content,
        Compatibility: input.compatibility || 'backward',
        AutoRegister: true,
      }],
    })

    // 4. Update schema with workflow ID
    await getPayload().update({
      collection: 'kafka-schemas',
      id: schema.id,
      data: { workflowId },
    })

    return { success: true, schemaId: schema.id, workflowId }
  } catch (error) {
    console.error('Failed to start schema validation workflow:', error)
    return { success: false, error: 'Failed to start workflow' }
  }
}
```

### 3.2 Share Approval (`triggerShareApprovedWorkflow`)

**File:** `orbit-www/src/app/actions/kafka-topic-shares.ts`

**Current:** Console.log stub

**Workflow Input (Go):**
```go
type AccessProvisioningWorkflowInput struct {
  ShareID     string
  TopicID     string
  TopicName   string
  WorkspaceID string
  Permission  string // "read", "write", "read_write"
  ExpiresAt   *time.Time
}
```

**Implementation:**
```typescript
async function triggerShareApprovedWorkflow(
  share: {
    id: string
    topic: { id: string; name: string; physicalName?: string }
    targetWorkspace: { id: string }
    permission: string
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
      Permission: share.permission,
      ExpiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : null,
    }],
  })

  // Update share with workflow ID
  await getPayload().update({
    collection: 'kafka-topic-shares',
    id: share.id,
    data: { workflowId },
  })
}
```

### 3.3 Share Revocation (`triggerShareRevokedWorkflow`)

**File:** `orbit-www/src/app/actions/kafka-topic-shares.ts`

**Current:** Console.log stub

**Workflow Input (Go):**
```go
type AccessRevocationWorkflowInput struct {
  ShareID     string
  TopicID     string
  WorkspaceID string
}
```

**Implementation:**
```typescript
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
}
```

### 3.4 Catalog Share Approval (`triggerShareApprovedWorkflow` in kafka-topic-catalog.ts)

**File:** `orbit-www/src/app/actions/kafka-topic-catalog.ts`

Same implementation as 3.2, but needs to fetch the full share record first since the catalog action only receives `shareId` and `topicId`.

```typescript
async function triggerShareApprovedWorkflow(shareId: string, topicId: string): Promise<void> {
  // Fetch full share record
  const share = await getPayload().findByID({
    collection: 'kafka-topic-shares',
    id: shareId,
    depth: 2, // Get topic and workspace details
  })

  if (!share) {
    throw new Error(`Share ${shareId} not found`)
  }

  const client = await getTemporalClient()
  const workflowId = `access-provision-${shareId}`

  const topic = typeof share.topic === 'string'
    ? await getPayload().findByID({ collection: 'kafka-topics', id: share.topic })
    : share.topic

  const targetWorkspace = typeof share.targetWorkspace === 'string'
    ? share.targetWorkspace
    : share.targetWorkspace.id

  await client.workflow.start('AccessProvisioningWorkflow', {
    taskQueue: 'orbit-workflows',
    workflowId,
    args: [{
      ShareID: shareId,
      TopicID: topicId,
      TopicName: topic?.physicalName || topic?.name || '',
      WorkspaceID: targetWorkspace,
      Permission: share.permission || 'read',
      ExpiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : null,
    }],
  })

  await getPayload().update({
    collection: 'kafka-topic-shares',
    id: shareId,
    data: { workflowId },
  })
}
```

---

## 4. Data Flow

### Schema Registration Flow (per original Bifrost design)

```
User submits schema in UI
         │
         ▼
┌─────────────────────────────────┐
│  registerSchema server action    │
│  • Validates auth                │
│  • Creates KafkaSchema record    │
│  • Starts workflow               │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  SchemaValidationWorkflow        │
│  1. UpdateSchemaStatus(validating)
│  2. ValidateSchema activity      │  ← Schema Registry CheckCompatibility
│  3. RegisterSchema activity      │  ← Schema Registry RegisterSchema
│  4. UpdateSchemaStatus(registered)
└─────────────────────────────────┘
         │
         ▼
UI polls or receives update via webhook
```

### Share Approval Flow (per original Bifrost design Section 5)

```
Owner approves share request
         │
         ▼
┌─────────────────────────────────┐
│  approveShare server action      │
│  • Updates share status          │
│  • Calls triggerShareApprovedWorkflow
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  AccessProvisioningWorkflow      │
│  1. UpdateShareStatus(provisioning)
│  2. ProvisionAccess activity     │  ← Kafka CreateACL
│  3. UpdateShareStatus(active)    │
│  4. (optional) Sleep until expiry│
│  5. (optional) RevokeAccess      │
└─────────────────────────────────┘
         │
         ▼
Consumer workspace can now access topic
```

---

## 5. Implementation Tasks

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update workflow task queues to `orbit-workflows` | `kafka_schema_workflow.go`, `kafka_access_workflow.go` |
| 2 | Implement `registerSchema` server action | `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/actions.ts` |
| 3 | Implement `triggerShareApprovedWorkflow` in shares | `orbit-www/src/app/actions/kafka-topic-shares.ts` |
| 4 | Implement `triggerShareRevokedWorkflow` in shares | `orbit-www/src/app/actions/kafka-topic-shares.ts` |
| 5 | Implement `triggerShareApprovedWorkflow` in catalog | `orbit-www/src/app/actions/kafka-topic-catalog.ts` |
| 6 | Add Temporal client import to share actions | `kafka-topic-shares.ts`, `kafka-topic-catalog.ts` |
| 7 | Test schema registration E2E | Manual test with UI |
| 8 | Test share approval/revocation E2E | Manual test with UI |

---

## 6. Testing Strategy

### Prerequisites
1. Docker dev environment running (`make dev`)
2. Redpanda with Schema Registry enabled
3. Temporal worker running
4. Test workspace and topic created

### Test Cases

**Schema Registration:**
1. Create topic in workspace
2. Navigate to topic schemas
3. Register a new Avro schema
4. Verify workflow starts in Temporal UI
5. Verify schema appears in Redpanda Console

**Share Approval:**
1. Create topic in Workspace A (set visibility to `discoverable`)
2. From Workspace B, request access via Topic Catalog
3. From Workspace A, approve the share request
4. Verify workflow starts in Temporal UI
5. Verify ACLs created in Redpanda Console

**Share Revocation:**
1. From Workspace A, revoke the share
2. Verify revocation workflow starts
3. Verify ACLs removed from Redpanda Console

---

## 7. Out of Scope

- `sendShareRequestNotification` - Email notifications (separate feature)
- `sendShareRejectedNotification` - Email notifications (separate feature)
- Service account Temporal triggers - Different workflow pattern
- Offset recovery Temporal triggers - OffsetRestoreWorkflow needs activities
- Application lifecycle triggers - Decommissioning activities still stubbed

---

## 8. Notes

### Go struct field naming

TypeScript must use PascalCase to match Go struct field names:
```typescript
// ✅ Correct - matches Go struct
{ ShareID: share.id, TopicID: topic.id }

// ❌ Wrong - won't deserialize in Go
{ shareId: share.id, topicId: topic.id }
```

### Temporal client singleton

Use existing `getTemporalClient()` from `@/lib/temporal/client` - already configured with correct address and namespace.
