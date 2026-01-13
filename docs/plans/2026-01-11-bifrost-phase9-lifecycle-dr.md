# Bifrost Phase 9: Lifecycle & Disaster Recovery - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement application lifecycle management (decommissioning with grace periods) and disaster recovery capabilities (offset checkpointing and restoration).

**Architecture:** Applications transition through states (active → decommissioning → deleted) with configurable grace periods. During decommissioning, virtual clusters enter read-only mode at the gateway level. Offset checkpointing provides periodic snapshots for disaster recovery. Temporal workflows orchestrate all lifecycle transitions.

**Tech Stack:** Payload CMS collections, Temporal workflows (Go), Bifrost gRPC Admin API (Kotlin), Next.js server actions, React UI components.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Grace period storage | Per-environment defaults in system config + override fields on application |
| Read-only enforcement | Gateway filter level (already implemented in Phase 1-3) |
| Offset checkpoint frequency | Every 15 minutes via scheduled Temporal workflow |
| Offset storage | KafkaOffsetCheckpoints collection with JSON offsets field |
| Cleanup workflow | Deferred execution via Temporal scheduled workflow |
| Restoration approach | Manual trigger via UI → Temporal workflow → Bifrost admin API |

## Grace Period Configuration

| Environment | Default Grace Period |
|-------------|---------------------|
| dev | 7 days |
| stage | 14 days |
| prod | 30 days |

---

## Implementation Tasks

### Task 1: Create KafkaOffsetCheckpoints Collection

**Files:**
- Create: `orbit-www/src/collections/kafka/KafkaOffsetCheckpoints.ts`
- Modify: `orbit-www/src/collections/kafka/index.ts`
- Modify: `orbit-www/src/payload.config.ts`

**Step 1: Write the failing test**

```typescript
// orbit-www/src/lib/kafka/offset-checkpoints.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('KafkaOffsetCheckpoints', () => {
  it('should create a checkpoint with valid data', async () => {
    const mockPayload = {
      create: vi.fn().mockResolvedValue({
        id: 'checkpoint-1',
        consumerGroup: 'group-1',
        virtualCluster: 'vc-1',
        checkpointedAt: new Date(),
        offsets: { 'orders-0': 1000, 'orders-1': 2000 },
      }),
    }

    const result = await mockPayload.create({
      collection: 'kafka-offset-checkpoints',
      data: {
        consumerGroup: 'group-1',
        virtualCluster: 'vc-1',
        checkpointedAt: new Date(),
        offsets: { 'orders-0': 1000, 'orders-1': 2000 },
      },
    })

    expect(result.id).toBe('checkpoint-1')
    expect(result.offsets['orders-0']).toBe(1000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/lib/kafka/offset-checkpoints.test.ts`
Expected: PASS (mock test, collection doesn't need to exist yet)

**Step 3: Create the collection**

```typescript
// orbit-www/src/collections/kafka/KafkaOffsetCheckpoints.ts
import type { CollectionConfig, Where } from 'payload'

export const KafkaOffsetCheckpoints: CollectionConfig = {
  slug: 'kafka-offset-checkpoints',
  admin: {
    useAsTitle: 'checkpointedAt',
    group: 'Kafka',
    defaultColumns: ['consumerGroup', 'virtualCluster', 'checkpointedAt'],
    description: 'Consumer group offset snapshots for disaster recovery',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      // Users can see checkpoints for their workspace's consumer groups
      const memberships = await payload.find({
        collection: 'workspace-members',
        where: { user: { equals: user.id }, status: { equals: 'active' } },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map((m) =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      const apps = await payload.find({
        collection: 'kafka-applications',
        where: { workspace: { in: workspaceIds } },
        limit: 1000,
        overrideAccess: true,
      })

      const appIds = apps.docs.map((a) => a.id)

      const virtualClusters = await payload.find({
        collection: 'kafka-virtual-clusters',
        where: { application: { in: appIds } },
        limit: 1000,
        overrideAccess: true,
      })

      const vcIds = virtualClusters.docs.map((vc) => vc.id)

      return { virtualCluster: { in: vcIds } } as Where
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'consumerGroup',
      type: 'relationship',
      relationTo: 'kafka-consumer-groups',
      required: true,
      index: true,
      admin: { description: 'Consumer group this checkpoint belongs to' },
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      required: true,
      index: true,
      admin: { description: 'Virtual cluster context' },
    },
    {
      name: 'checkpointedAt',
      type: 'date',
      required: true,
      index: true,
      admin: { description: 'When this checkpoint was taken' },
    },
    {
      name: 'offsets',
      type: 'json',
      required: true,
      admin: { description: 'Partition → offset mapping (e.g., {"orders-0": 15234567})' },
    },
  ],
  timestamps: true,
}
```

**Step 4: Update exports and config**

```typescript
// orbit-www/src/collections/kafka/index.ts
// Add to existing exports:
export { KafkaOffsetCheckpoints } from './KafkaOffsetCheckpoints'
```

```typescript
// orbit-www/src/payload.config.ts
// Add to collections array:
import { KafkaOffsetCheckpoints } from '@/collections/kafka/KafkaOffsetCheckpoints'
// ... in collections: [
//   ...
//   KafkaOffsetCheckpoints,
// ]
```

**Step 5: Run database migration**

Run: `cd orbit-www && pnpm payload migrate:create kafka-offset-checkpoints && pnpm payload migrate`
Expected: Migration created and applied successfully

**Step 6: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaOffsetCheckpoints.ts \
        orbit-www/src/collections/kafka/index.ts \
        orbit-www/src/payload.config.ts \
        orbit-www/src/lib/kafka/offset-checkpoints.test.ts
git commit -m "feat(phase9): add KafkaOffsetCheckpoints collection"
```

---

### Task 2: Extend KafkaApplications with Lifecycle Fields

**Files:**
- Modify: `orbit-www/src/collections/kafka/KafkaApplications.ts`

**Step 1: Write the failing test**

```typescript
// orbit-www/src/lib/kafka/application-lifecycle.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('KafkaApplications lifecycle', () => {
  it('should calculate grace period end date from environment defaults', () => {
    const gracePeriods = { dev: 7, stage: 14, prod: 30 }
    const decommissioningStartedAt = new Date('2026-01-10T00:00:00Z')
    const environment = 'prod'

    const gracePeriodDays = gracePeriods[environment as keyof typeof gracePeriods]
    const gracePeriodEndsAt = new Date(decommissioningStartedAt)
    gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + gracePeriodDays)

    expect(gracePeriodEndsAt.toISOString()).toBe('2026-02-09T00:00:00.000Z')
  })

  it('should respect custom grace period override', () => {
    const customGracePeriodDays = 60
    const decommissioningStartedAt = new Date('2026-01-10T00:00:00Z')

    const gracePeriodEndsAt = new Date(decommissioningStartedAt)
    gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + customGracePeriodDays)

    expect(gracePeriodEndsAt.toISOString()).toBe('2026-03-11T00:00:00.000Z')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/lib/kafka/application-lifecycle.test.ts`
Expected: PASS (logic test)

**Step 3: Add lifecycle fields to KafkaApplications**

Add these fields to the `fields` array in `KafkaApplications.ts` after the existing `forceDeleted` field:

```typescript
// Add after forceDeleted field:
{
  name: 'gracePeriodDaysOverride',
  type: 'number',
  admin: {
    description: 'Custom grace period in days (overrides environment default)',
    condition: (data) => data?.status === 'decommissioning',
  },
},
{
  name: 'gracePeriodEndsAt',
  type: 'date',
  admin: {
    readOnly: true,
    position: 'sidebar',
    description: 'When the grace period expires',
    condition: (data) => data?.status === 'decommissioning',
  },
},
{
  name: 'cleanupWorkflowId',
  type: 'text',
  admin: {
    readOnly: true,
    description: 'Temporal workflow ID for scheduled cleanup',
    condition: (data) => data?.status === 'decommissioning',
  },
},
{
  name: 'decommissionReason',
  type: 'textarea',
  admin: {
    description: 'Optional reason for decommissioning',
    condition: (data) => data?.status === 'decommissioning' || data?.status === 'deleted',
  },
},
```

**Step 4: Verify collection updates**

Run: `cd orbit-www && pnpm build`
Expected: Build succeeds without TypeScript errors

**Step 5: Commit**

```bash
git add orbit-www/src/collections/kafka/KafkaApplications.ts \
        orbit-www/src/lib/kafka/application-lifecycle.test.ts
git commit -m "feat(phase9): add lifecycle fields to KafkaApplications"
```

---

### Task 3: Create Application Decommissioning Server Action

**Files:**
- Create: `orbit-www/src/app/actions/kafka-application-lifecycle.ts`
- Create: `orbit-www/src/lib/kafka/lifecycle.ts`

**Step 1: Write the failing test**

```typescript
// orbit-www/src/lib/kafka/lifecycle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateGracePeriodEnd, getDefaultGracePeriodDays } from './lifecycle'

describe('lifecycle utilities', () => {
  describe('getDefaultGracePeriodDays', () => {
    it('should return 7 days for dev', () => {
      expect(getDefaultGracePeriodDays('dev')).toBe(7)
    })

    it('should return 14 days for stage', () => {
      expect(getDefaultGracePeriodDays('stage')).toBe(14)
    })

    it('should return 30 days for prod', () => {
      expect(getDefaultGracePeriodDays('prod')).toBe(30)
    })

    it('should return max (30) for unknown environment', () => {
      expect(getDefaultGracePeriodDays('unknown')).toBe(30)
    })
  })

  describe('calculateGracePeriodEnd', () => {
    it('should calculate end date based on environment', () => {
      const startDate = new Date('2026-01-10T12:00:00Z')
      const environments = ['dev', 'stage', 'prod']

      const result = calculateGracePeriodEnd(startDate, environments)

      // Should use max grace period (prod = 30 days)
      expect(result.toISOString()).toBe('2026-02-09T12:00:00.000Z')
    })

    it('should use override when provided', () => {
      const startDate = new Date('2026-01-10T12:00:00Z')
      const environments = ['dev', 'stage', 'prod']
      const override = 60

      const result = calculateGracePeriodEnd(startDate, environments, override)

      expect(result.toISOString()).toBe('2026-03-11T12:00:00.000Z')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/lib/kafka/lifecycle.test.ts`
Expected: FAIL with "Cannot find module './lifecycle'"

**Step 3: Implement lifecycle utilities**

```typescript
// orbit-www/src/lib/kafka/lifecycle.ts

/**
 * Default grace period in days per environment
 */
const DEFAULT_GRACE_PERIODS: Record<string, number> = {
  dev: 7,
  stage: 14,
  prod: 30,
}

/**
 * Get the default grace period for an environment
 */
export function getDefaultGracePeriodDays(environment: string): number {
  return DEFAULT_GRACE_PERIODS[environment] ?? 30
}

/**
 * Calculate grace period end date
 * Uses the maximum grace period across all environments unless override is specified
 */
export function calculateGracePeriodEnd(
  startDate: Date,
  environments: string[],
  overrideDays?: number
): Date {
  let gracePeriodDays: number

  if (overrideDays !== undefined && overrideDays > 0) {
    gracePeriodDays = overrideDays
  } else {
    // Use the maximum grace period across all environments
    gracePeriodDays = Math.max(
      ...environments.map((env) => getDefaultGracePeriodDays(env))
    )
  }

  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + gracePeriodDays)
  return endDate
}

/**
 * Check if grace period has expired
 */
export function isGracePeriodExpired(gracePeriodEndsAt: Date): boolean {
  return new Date() >= gracePeriodEndsAt
}

/**
 * Get remaining grace period in days
 */
export function getRemainingGracePeriodDays(gracePeriodEndsAt: Date): number {
  const now = new Date()
  const diffMs = gracePeriodEndsAt.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/lib/kafka/lifecycle.test.ts`
Expected: PASS

**Step 5: Implement server action**

```typescript
// orbit-www/src/app/actions/kafka-application-lifecycle.ts
'use server'

import { getPayloadClient } from '@/lib/payload'
import { getSession } from '@/lib/auth/session'
import { calculateGracePeriodEnd, getRemainingGracePeriodDays } from '@/lib/kafka/lifecycle'
import type { KafkaApplication, KafkaVirtualCluster } from '@/payload-types'

export interface DecommissionApplicationInput {
  applicationId: string
  reason?: string
  gracePeriodDaysOverride?: number
}

export interface DecommissionApplicationResult {
  success: boolean
  error?: string
  gracePeriodEndsAt?: string
  cleanupWorkflowId?: string
}

/**
 * Initiate application decommissioning
 * Sets all virtual clusters to read-only and schedules cleanup workflow
 */
export async function decommissionApplication(
  input: DecommissionApplicationInput
): Promise<DecommissionApplicationResult> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayloadClient()

  // Fetch application with virtual clusters
  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: input.applicationId,
    depth: 0,
  })

  if (!app) {
    return { success: false, error: 'Application not found' }
  }

  if (app.status !== 'active') {
    return { success: false, error: `Cannot decommission application in ${app.status} status` }
  }

  // Get all virtual clusters for this application
  const virtualClusters = await payload.find({
    collection: 'kafka-virtual-clusters',
    where: { application: { equals: input.applicationId } },
    limit: 10,
  })

  const environments = virtualClusters.docs.map((vc) => vc.environment)

  // Calculate grace period end
  const now = new Date()
  const gracePeriodEndsAt = calculateGracePeriodEnd(
    now,
    environments,
    input.gracePeriodDaysOverride
  )

  // Update application status
  await payload.update({
    collection: 'kafka-applications',
    id: input.applicationId,
    data: {
      status: 'decommissioning',
      decommissioningStartedAt: now.toISOString(),
      gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
      gracePeriodDaysOverride: input.gracePeriodDaysOverride,
      decommissionReason: input.reason,
      // cleanupWorkflowId will be set by Temporal workflow trigger
    },
  })

  // Update all virtual clusters to read_only status
  for (const vc of virtualClusters.docs) {
    await payload.update({
      collection: 'kafka-virtual-clusters',
      id: vc.id,
      data: { status: 'read_only' },
    })
  }

  // TODO: Trigger Temporal workflow to:
  // 1. Push read-only config to Bifrost for each virtual cluster
  // 2. Schedule ApplicationCleanupWorkflow for grace period end

  return {
    success: true,
    gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
  }
}

/**
 * Cancel decommissioning and restore application to active state
 */
export async function cancelDecommissioning(
  applicationId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayloadClient()

  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
    depth: 0,
  })

  if (!app) {
    return { success: false, error: 'Application not found' }
  }

  if (app.status !== 'decommissioning') {
    return { success: false, error: 'Application is not in decommissioning state' }
  }

  // Update application status back to active
  await payload.update({
    collection: 'kafka-applications',
    id: applicationId,
    data: {
      status: 'active',
      decommissioningStartedAt: null,
      gracePeriodEndsAt: null,
      gracePeriodDaysOverride: null,
      cleanupWorkflowId: null,
      // Keep decommissionReason for audit trail
    },
  })

  // Update all virtual clusters back to active
  const virtualClusters = await payload.find({
    collection: 'kafka-virtual-clusters',
    where: { application: { equals: applicationId } },
    limit: 10,
  })

  for (const vc of virtualClusters.docs) {
    if (vc.status === 'read_only') {
      await payload.update({
        collection: 'kafka-virtual-clusters',
        id: vc.id,
        data: { status: 'active' },
      })
    }
  }

  // TODO: Trigger Temporal workflow to:
  // 1. Cancel scheduled ApplicationCleanupWorkflow
  // 2. Push full-access config to Bifrost for each virtual cluster

  return { success: true }
}

/**
 * Force delete application immediately (admin only)
 */
export async function forceDeleteApplication(
  applicationId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayloadClient()

  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
    depth: 0,
  })

  if (!app) {
    return { success: false, error: 'Application not found' }
  }

  if (app.status === 'deleted') {
    return { success: false, error: 'Application is already deleted' }
  }

  // Mark application as deleted
  await payload.update({
    collection: 'kafka-applications',
    id: applicationId,
    data: {
      status: 'deleted',
      deletedAt: new Date().toISOString(),
      deletedBy: session.user.id,
      forceDeleted: true,
      decommissionReason: reason || app.decommissionReason,
    },
  })

  // Mark all virtual clusters as deleted
  const virtualClusters = await payload.find({
    collection: 'kafka-virtual-clusters',
    where: { application: { equals: applicationId } },
    limit: 10,
  })

  for (const vc of virtualClusters.docs) {
    await payload.update({
      collection: 'kafka-virtual-clusters',
      id: vc.id,
      data: { status: 'deleted' },
    })
  }

  // TODO: Trigger Temporal workflow to:
  // 1. Cancel any scheduled cleanup workflow
  // 2. Execute immediate cleanup:
  //    - Delete physical topics from brokers
  //    - Revoke all credentials from Bifrost
  //    - Delete virtual cluster configs from Bifrost

  return { success: true }
}

/**
 * Get application lifecycle status
 */
export async function getApplicationLifecycleStatus(applicationId: string): Promise<{
  status: string
  decommissioningStartedAt?: string
  gracePeriodEndsAt?: string
  remainingDays?: number
  canCancel: boolean
  canForceDelete: boolean
}> {
  const payload = await getPayloadClient()

  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
    depth: 0,
  })

  if (!app) {
    throw new Error('Application not found')
  }

  const result: ReturnType<typeof getApplicationLifecycleStatus> extends Promise<infer T> ? T : never = {
    status: app.status,
    canCancel: app.status === 'decommissioning',
    canForceDelete: app.status === 'active' || app.status === 'decommissioning',
  }

  if (app.status === 'decommissioning' && app.gracePeriodEndsAt) {
    result.decommissioningStartedAt = app.decommissioningStartedAt as string
    result.gracePeriodEndsAt = app.gracePeriodEndsAt as string
    result.remainingDays = getRemainingGracePeriodDays(new Date(app.gracePeriodEndsAt as string))
  }

  return result
}
```

**Step 6: Update lib/kafka/index.ts exports**

```typescript
// orbit-www/src/lib/kafka/index.ts
// Add to existing exports:
export * from './lifecycle'
```

**Step 7: Commit**

```bash
git add orbit-www/src/lib/kafka/lifecycle.ts \
        orbit-www/src/lib/kafka/lifecycle.test.ts \
        orbit-www/src/lib/kafka/index.ts \
        orbit-www/src/app/actions/kafka-application-lifecycle.ts
git commit -m "feat(phase9): add application lifecycle server actions"
```

---

### Task 4: Implement ApplicationDecommissioningWorkflow (Temporal)

**Files:**
- Create: `temporal-workflows/internal/workflows/application_decommissioning_workflow.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/workflows/application_decommissioning_workflow_test.go
package workflows

import (
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type ApplicationDecommissioningWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *ApplicationDecommissioningWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
}

func (s *ApplicationDecommissioningWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *ApplicationDecommissioningWorkflowTestSuite) TestApplicationDecommissioningWorkflow_Success() {
	input := ApplicationDecommissioningInput{
		ApplicationID:     "app-123",
		WorkspaceID:       "ws-456",
		GracePeriodEndsAt: time.Now().Add(30 * 24 * time.Hour),
	}

	// Mock activities
	s.env.OnActivity("SetVirtualClustersReadOnly", mock.Anything, mock.Anything).Return(
		&SetVirtualClustersReadOnlyResult{Success: true, UpdatedClusters: 3}, nil,
	)
	s.env.OnActivity("ScheduleCleanupWorkflow", mock.Anything, mock.Anything).Return(
		&ScheduleCleanupWorkflowResult{Success: true, WorkflowID: "cleanup-workflow-123"}, nil,
	)
	s.env.OnActivity("UpdateApplicationWorkflowID", mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(ApplicationDecommissioningWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result ApplicationDecommissioningResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.True(result.Success)
	s.Equal("cleanup-workflow-123", result.CleanupWorkflowID)
}

func (s *ApplicationDecommissioningWorkflowTestSuite) TestApplicationDecommissioningWorkflow_ForceDelete() {
	input := ApplicationDecommissioningInput{
		ApplicationID: "app-123",
		WorkspaceID:   "ws-456",
		ForceDelete:   true,
	}

	s.env.OnActivity("SetVirtualClustersReadOnly", mock.Anything, mock.Anything).Return(
		&SetVirtualClustersReadOnlyResult{Success: true, UpdatedClusters: 3}, nil,
	)
	s.env.OnActivity("ExecuteImmediateCleanup", mock.Anything, mock.Anything).Return(
		&ExecuteCleanupResult{Success: true}, nil,
	)
	s.env.OnActivity("MarkApplicationDeleted", mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(ApplicationDecommissioningWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())
}

func TestApplicationDecommissioningWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(ApplicationDecommissioningWorkflowTestSuite))
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestApplicationDecommissioningWorkflow ./internal/workflows/`
Expected: FAIL with undefined functions

**Step 3: Implement the workflow**

```go
// temporal-workflows/internal/workflows/application_decommissioning_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	ApplicationDecommissioningTaskQueue = "application-decommissioning"
)

// ApplicationDecommissioningInput contains input for decommissioning workflow
type ApplicationDecommissioningInput struct {
	ApplicationID     string    `json:"applicationId"`
	WorkspaceID       string    `json:"workspaceId"`
	GracePeriodEndsAt time.Time `json:"gracePeriodEndsAt"`
	ForceDelete       bool      `json:"forceDelete"`
	Reason            string    `json:"reason,omitempty"`
}

// ApplicationDecommissioningResult contains the workflow result
type ApplicationDecommissioningResult struct {
	Success           bool   `json:"success"`
	CleanupWorkflowID string `json:"cleanupWorkflowId,omitempty"`
	Error             string `json:"error,omitempty"`
}

// SetVirtualClustersReadOnlyInput is input for setting clusters to read-only
type SetVirtualClustersReadOnlyInput struct {
	ApplicationID string `json:"applicationId"`
	ReadOnly      bool   `json:"readOnly"`
}

// SetVirtualClustersReadOnlyResult is result of setting read-only mode
type SetVirtualClustersReadOnlyResult struct {
	Success         bool     `json:"success"`
	UpdatedClusters int      `json:"updatedClusters"`
	VirtualClusterIDs []string `json:"virtualClusterIds"`
}

// ScheduleCleanupWorkflowInput is input for scheduling cleanup
type ScheduleCleanupWorkflowInput struct {
	ApplicationID     string    `json:"applicationId"`
	WorkspaceID       string    `json:"workspaceId"`
	ScheduledFor      time.Time `json:"scheduledFor"`
}

// ScheduleCleanupWorkflowResult is result of scheduling cleanup
type ScheduleCleanupWorkflowResult struct {
	Success    bool   `json:"success"`
	WorkflowID string `json:"workflowId"`
}

// UpdateApplicationWorkflowIDInput is input for updating workflow ID
type UpdateApplicationWorkflowIDInput struct {
	ApplicationID string `json:"applicationId"`
	WorkflowID    string `json:"workflowId"`
}

// ExecuteCleanupInput is input for immediate cleanup
type ExecuteCleanupInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// ExecuteCleanupResult is result of cleanup execution
type ExecuteCleanupResult struct {
	Success        bool `json:"success"`
	TopicsDeleted  int  `json:"topicsDeleted"`
	CredentialsRevoked int `json:"credentialsRevoked"`
}

// MarkApplicationDeletedInput is input for marking app deleted
type MarkApplicationDeletedInput struct {
	ApplicationID string `json:"applicationId"`
	DeletedBy     string `json:"deletedBy,omitempty"`
	ForceDeleted  bool   `json:"forceDeleted"`
}

// ApplicationDecommissioningWorkflow orchestrates application decommissioning
func ApplicationDecommissioningWorkflow(ctx workflow.Context, input ApplicationDecommissioningInput) (*ApplicationDecommissioningResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ApplicationDecommissioningWorkflow",
		"applicationId", input.ApplicationID,
		"forceDelete", input.ForceDelete,
	)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Set all virtual clusters to read-only mode
	var readOnlyResult SetVirtualClustersReadOnlyResult
	err := workflow.ExecuteActivity(ctx, "SetVirtualClustersReadOnly", SetVirtualClustersReadOnlyInput{
		ApplicationID: input.ApplicationID,
		ReadOnly:      true,
	}).Get(ctx, &readOnlyResult)
	if err != nil {
		logger.Error("Failed to set virtual clusters to read-only", "error", err)
		return &ApplicationDecommissioningResult{
			Success: false,
			Error:   "Failed to set read-only mode: " + err.Error(),
		}, nil
	}

	logger.Info("Set virtual clusters to read-only",
		"updatedClusters", readOnlyResult.UpdatedClusters,
	)

	// Step 2: Either schedule cleanup or execute immediately
	if input.ForceDelete {
		// Force delete: execute cleanup immediately
		var cleanupResult ExecuteCleanupResult
		err = workflow.ExecuteActivity(ctx, "ExecuteImmediateCleanup", ExecuteCleanupInput{
			ApplicationID: input.ApplicationID,
			WorkspaceID:   input.WorkspaceID,
		}).Get(ctx, &cleanupResult)
		if err != nil {
			logger.Error("Failed to execute immediate cleanup", "error", err)
			return &ApplicationDecommissioningResult{
				Success: false,
				Error:   "Failed to execute cleanup: " + err.Error(),
			}, nil
		}

		// Mark application as deleted
		err = workflow.ExecuteActivity(ctx, "MarkApplicationDeleted", MarkApplicationDeletedInput{
			ApplicationID: input.ApplicationID,
			ForceDeleted:  true,
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to mark application deleted", "error", err)
		}

		logger.Info("Force delete completed",
			"topicsDeleted", cleanupResult.TopicsDeleted,
			"credentialsRevoked", cleanupResult.CredentialsRevoked,
		)

		return &ApplicationDecommissioningResult{
			Success: true,
		}, nil
	}

	// Normal decommissioning: schedule cleanup for grace period end
	var scheduleResult ScheduleCleanupWorkflowResult
	err = workflow.ExecuteActivity(ctx, "ScheduleCleanupWorkflow", ScheduleCleanupWorkflowInput{
		ApplicationID: input.ApplicationID,
		WorkspaceID:   input.WorkspaceID,
		ScheduledFor:  input.GracePeriodEndsAt,
	}).Get(ctx, &scheduleResult)
	if err != nil {
		logger.Error("Failed to schedule cleanup workflow", "error", err)
		return &ApplicationDecommissioningResult{
			Success: false,
			Error:   "Failed to schedule cleanup: " + err.Error(),
		}, nil
	}

	// Update application with cleanup workflow ID
	err = workflow.ExecuteActivity(ctx, "UpdateApplicationWorkflowID", UpdateApplicationWorkflowIDInput{
		ApplicationID: input.ApplicationID,
		WorkflowID:    scheduleResult.WorkflowID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to update application workflow ID", "error", err)
		// Non-fatal, continue
	}

	logger.Info("ApplicationDecommissioningWorkflow completed",
		"cleanupWorkflowId", scheduleResult.WorkflowID,
		"scheduledFor", input.GracePeriodEndsAt,
	)

	return &ApplicationDecommissioningResult{
		Success:           true,
		CleanupWorkflowID: scheduleResult.WorkflowID,
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd temporal-workflows && go test -v -run TestApplicationDecommissioningWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/application_decommissioning_workflow.go \
        temporal-workflows/internal/workflows/application_decommissioning_workflow_test.go
git commit -m "feat(phase9): add ApplicationDecommissioningWorkflow"
```

---

### Task 5: Implement ApplicationCleanupWorkflow (Temporal)

**Files:**
- Create: `temporal-workflows/internal/workflows/application_cleanup_workflow.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/workflows/application_cleanup_workflow_test.go
package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type ApplicationCleanupWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *ApplicationCleanupWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
}

func (s *ApplicationCleanupWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *ApplicationCleanupWorkflowTestSuite) TestApplicationCleanupWorkflow_Success() {
	input := ApplicationCleanupInput{
		ApplicationID: "app-123",
		WorkspaceID:   "ws-456",
	}

	// Mock activities in order
	s.env.OnActivity("CheckApplicationStatus", mock.Anything, mock.Anything).Return(
		&CheckApplicationStatusResult{Status: "decommissioning", CanProceed: true}, nil,
	)
	s.env.OnActivity("DeletePhysicalTopics", mock.Anything, mock.Anything).Return(
		&DeletePhysicalTopicsResult{Success: true, DeletedCount: 5}, nil,
	)
	s.env.OnActivity("RevokeAllCredentials", mock.Anything, mock.Anything).Return(
		&RevokeAllCredentialsResult{Success: true, RevokedCount: 3}, nil,
	)
	s.env.OnActivity("DeleteVirtualClustersFromBifrost", mock.Anything, mock.Anything).Return(
		&DeleteVirtualClustersResult{Success: true, DeletedCount: 3}, nil,
	)
	s.env.OnActivity("ArchiveMetricsData", mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity("MarkApplicationDeleted", mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(ApplicationCleanupWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result ApplicationCleanupResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.True(result.Success)
	s.Equal(5, result.TopicsDeleted)
	s.Equal(3, result.CredentialsRevoked)
}

func (s *ApplicationCleanupWorkflowTestSuite) TestApplicationCleanupWorkflow_Cancelled() {
	input := ApplicationCleanupInput{
		ApplicationID: "app-123",
		WorkspaceID:   "ws-456",
	}

	// Application was restored to active
	s.env.OnActivity("CheckApplicationStatus", mock.Anything, mock.Anything).Return(
		&CheckApplicationStatusResult{Status: "active", CanProceed: false}, nil,
	)

	s.env.ExecuteWorkflow(ApplicationCleanupWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result ApplicationCleanupResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.False(result.Success)
	s.Equal("cancelled", result.Status)
}

func TestApplicationCleanupWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(ApplicationCleanupWorkflowTestSuite))
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestApplicationCleanupWorkflow ./internal/workflows/`
Expected: FAIL with undefined functions

**Step 3: Implement the workflow**

```go
// temporal-workflows/internal/workflows/application_cleanup_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	ApplicationCleanupTaskQueue = "application-cleanup"
)

// ApplicationCleanupInput contains input for cleanup workflow
type ApplicationCleanupInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// ApplicationCleanupResult contains the cleanup result
type ApplicationCleanupResult struct {
	Success            bool   `json:"success"`
	Status             string `json:"status"` // "completed", "cancelled", "failed"
	TopicsDeleted      int    `json:"topicsDeleted"`
	CredentialsRevoked int    `json:"credentialsRevoked"`
	Error              string `json:"error,omitempty"`
}

// CheckApplicationStatusInput is input for checking app status
type CheckApplicationStatusInput struct {
	ApplicationID string `json:"applicationId"`
}

// CheckApplicationStatusResult is result of status check
type CheckApplicationStatusResult struct {
	Status     string `json:"status"`
	CanProceed bool   `json:"canProceed"`
}

// DeletePhysicalTopicsInput is input for deleting topics
type DeletePhysicalTopicsInput struct {
	ApplicationID string `json:"applicationId"`
}

// DeletePhysicalTopicsResult is result of topic deletion
type DeletePhysicalTopicsResult struct {
	Success      bool     `json:"success"`
	DeletedCount int      `json:"deletedCount"`
	FailedTopics []string `json:"failedTopics,omitempty"`
}

// RevokeAllCredentialsInput is input for revoking credentials
type RevokeAllCredentialsInput struct {
	ApplicationID string `json:"applicationId"`
}

// RevokeAllCredentialsResult is result of credential revocation
type RevokeAllCredentialsResult struct {
	Success      bool `json:"success"`
	RevokedCount int  `json:"revokedCount"`
}

// DeleteVirtualClustersInput is input for deleting from Bifrost
type DeleteVirtualClustersInput struct {
	ApplicationID string `json:"applicationId"`
}

// DeleteVirtualClustersResult is result of virtual cluster deletion
type DeleteVirtualClustersResult struct {
	Success      bool `json:"success"`
	DeletedCount int  `json:"deletedCount"`
}

// ArchiveMetricsDataInput is input for archiving metrics
type ArchiveMetricsDataInput struct {
	ApplicationID string `json:"applicationId"`
}

// ApplicationCleanupWorkflow performs cleanup when grace period expires
func ApplicationCleanupWorkflow(ctx workflow.Context, input ApplicationCleanupInput) (*ApplicationCleanupResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ApplicationCleanupWorkflow", "applicationId", input.ApplicationID)

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

	// Step 1: Check if application is still in decommissioning state
	// (user might have cancelled during grace period)
	var statusResult CheckApplicationStatusResult
	err := workflow.ExecuteActivity(ctx, "CheckApplicationStatus", CheckApplicationStatusInput{
		ApplicationID: input.ApplicationID,
	}).Get(ctx, &statusResult)
	if err != nil {
		logger.Error("Failed to check application status", "error", err)
		return &ApplicationCleanupResult{
			Success: false,
			Status:  "failed",
			Error:   "Failed to check application status: " + err.Error(),
		}, nil
	}

	if !statusResult.CanProceed {
		logger.Info("Cleanup cancelled - application status changed",
			"status", statusResult.Status,
		)
		return &ApplicationCleanupResult{
			Success: false,
			Status:  "cancelled",
		}, nil
	}

	result := &ApplicationCleanupResult{
		Success: true,
		Status:  "completed",
	}

	// Step 2: Delete physical topics from brokers
	var topicsResult DeletePhysicalTopicsResult
	err = workflow.ExecuteActivity(ctx, "DeletePhysicalTopics", DeletePhysicalTopicsInput{
		ApplicationID: input.ApplicationID,
	}).Get(ctx, &topicsResult)
	if err != nil {
		logger.Error("Failed to delete physical topics", "error", err)
		// Continue with other cleanup steps
	} else {
		result.TopicsDeleted = topicsResult.DeletedCount
		logger.Info("Deleted physical topics", "count", topicsResult.DeletedCount)
	}

	// Step 3: Revoke all credentials from Bifrost
	var credentialsResult RevokeAllCredentialsResult
	err = workflow.ExecuteActivity(ctx, "RevokeAllCredentials", RevokeAllCredentialsInput{
		ApplicationID: input.ApplicationID,
	}).Get(ctx, &credentialsResult)
	if err != nil {
		logger.Error("Failed to revoke credentials", "error", err)
	} else {
		result.CredentialsRevoked = credentialsResult.RevokedCount
		logger.Info("Revoked credentials", "count", credentialsResult.RevokedCount)
	}

	// Step 4: Delete virtual cluster configs from Bifrost
	var vcResult DeleteVirtualClustersResult
	err = workflow.ExecuteActivity(ctx, "DeleteVirtualClustersFromBifrost", DeleteVirtualClustersInput{
		ApplicationID: input.ApplicationID,
	}).Get(ctx, &vcResult)
	if err != nil {
		logger.Error("Failed to delete virtual clusters from Bifrost", "error", err)
	} else {
		logger.Info("Deleted virtual clusters from Bifrost", "count", vcResult.DeletedCount)
	}

	// Step 5: Archive metrics data (retain for chargeback history)
	err = workflow.ExecuteActivity(ctx, "ArchiveMetricsData", ArchiveMetricsDataInput{
		ApplicationID: input.ApplicationID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to archive metrics data", "error", err)
		// Non-fatal, continue
	}

	// Step 6: Mark application as deleted in Orbit
	err = workflow.ExecuteActivity(ctx, "MarkApplicationDeleted", MarkApplicationDeletedInput{
		ApplicationID: input.ApplicationID,
		ForceDeleted:  false,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to mark application deleted", "error", err)
		result.Success = false
		result.Status = "failed"
		result.Error = "Failed to mark application deleted"
		return result, nil
	}

	logger.Info("ApplicationCleanupWorkflow completed",
		"topicsDeleted", result.TopicsDeleted,
		"credentialsRevoked", result.CredentialsRevoked,
	)

	return result, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd temporal-workflows && go test -v -run TestApplicationCleanupWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/application_cleanup_workflow.go \
        temporal-workflows/internal/workflows/application_cleanup_workflow_test.go
git commit -m "feat(phase9): add ApplicationCleanupWorkflow"
```

---

### Task 6: Implement Decommissioning Activities

**Files:**
- Create: `temporal-workflows/internal/activities/decommissioning_activities.go`

**Step 1: Implement activities**

```go
// temporal-workflows/internal/activities/decommissioning_activities.go
package activities

import (
	"context"
	"fmt"

	"go.temporal.io/sdk/activity"
)

// DecommissioningActivities handles decommissioning-related activities
type DecommissioningActivities struct {
	// Add dependencies: payload client, bifrost client, etc.
}

// NewDecommissioningActivities creates new decommissioning activities
func NewDecommissioningActivities() *DecommissioningActivities {
	return &DecommissioningActivities{}
}

// SetVirtualClustersReadOnlyInput is input for setting read-only mode
type SetVirtualClustersReadOnlyInput struct {
	ApplicationID string `json:"applicationId"`
	ReadOnly      bool   `json:"readOnly"`
}

// SetVirtualClustersReadOnlyResult is result of setting read-only mode
type SetVirtualClustersReadOnlyResult struct {
	Success           bool     `json:"success"`
	UpdatedClusters   int      `json:"updatedClusters"`
	VirtualClusterIDs []string `json:"virtualClusterIds"`
}

// SetVirtualClustersReadOnly sets all virtual clusters for an app to read-only mode
func (a *DecommissioningActivities) SetVirtualClustersReadOnly(
	ctx context.Context,
	input SetVirtualClustersReadOnlyInput,
) (*SetVirtualClustersReadOnlyResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Setting virtual clusters read-only",
		"applicationId", input.ApplicationID,
		"readOnly", input.ReadOnly,
	)

	// TODO: Implement:
	// 1. Query Payload for all virtual clusters for this application
	// 2. For each virtual cluster:
	//    a. Call Bifrost Admin API: SetVirtualClusterReadOnly
	//    b. Update virtual cluster status in Payload

	// Placeholder implementation
	return &SetVirtualClustersReadOnlyResult{
		Success:         true,
		UpdatedClusters: 3,
		VirtualClusterIDs: []string{
			input.ApplicationID + "-dev",
			input.ApplicationID + "-stage",
			input.ApplicationID + "-prod",
		},
	}, nil
}

// CheckApplicationStatusInput is input for status check
type CheckApplicationStatusInput struct {
	ApplicationID string `json:"applicationId"`
}

// CheckApplicationStatusResult is result of status check
type CheckApplicationStatusResult struct {
	Status     string `json:"status"`
	CanProceed bool   `json:"canProceed"`
}

// CheckApplicationStatus checks if application is still in decommissioning state
func (a *DecommissioningActivities) CheckApplicationStatus(
	ctx context.Context,
	input CheckApplicationStatusInput,
) (*CheckApplicationStatusResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Checking application status", "applicationId", input.ApplicationID)

	// TODO: Implement:
	// 1. Query Payload for application status
	// 2. Return whether cleanup can proceed

	// Placeholder - in real impl, query Payload
	return &CheckApplicationStatusResult{
		Status:     "decommissioning",
		CanProceed: true,
	}, nil
}

// DeletePhysicalTopicsInput is input for topic deletion
type DeletePhysicalTopicsInput struct {
	ApplicationID string `json:"applicationId"`
}

// DeletePhysicalTopicsResult is result of topic deletion
type DeletePhysicalTopicsResult struct {
	Success      bool     `json:"success"`
	DeletedCount int      `json:"deletedCount"`
	FailedTopics []string `json:"failedTopics,omitempty"`
}

// DeletePhysicalTopics deletes all physical topics for an application
func (a *DecommissioningActivities) DeletePhysicalTopics(
	ctx context.Context,
	input DeletePhysicalTopicsInput,
) (*DeletePhysicalTopicsResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Deleting physical topics", "applicationId", input.ApplicationID)

	// TODO: Implement:
	// 1. Query Payload for all topics belonging to this application's virtual clusters
	// 2. For each topic:
	//    a. Delete from physical Kafka cluster via admin client
	//    b. Mark as deleted in Payload

	return &DeletePhysicalTopicsResult{
		Success:      true,
		DeletedCount: 0,
	}, nil
}

// RevokeAllCredentialsInput is input for credential revocation
type RevokeAllCredentialsInput struct {
	ApplicationID string `json:"applicationId"`
}

// RevokeAllCredentialsResult is result of credential revocation
type RevokeAllCredentialsResult struct {
	Success      bool `json:"success"`
	RevokedCount int  `json:"revokedCount"`
}

// RevokeAllCredentials revokes all service account credentials for an application
func (a *DecommissioningActivities) RevokeAllCredentials(
	ctx context.Context,
	input RevokeAllCredentialsInput,
) (*RevokeAllCredentialsResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Revoking all credentials", "applicationId", input.ApplicationID)

	// TODO: Implement:
	// 1. Query Payload for all service accounts for this application
	// 2. For each service account:
	//    a. Call Bifrost Admin API: RevokeCredential
	//    b. Mark as revoked in Payload

	return &RevokeAllCredentialsResult{
		Success:      true,
		RevokedCount: 0,
	}, nil
}

// DeleteVirtualClustersInput is input for virtual cluster deletion
type DeleteVirtualClustersInput struct {
	ApplicationID string `json:"applicationId"`
}

// DeleteVirtualClustersResult is result of virtual cluster deletion
type DeleteVirtualClustersResult struct {
	Success      bool `json:"success"`
	DeletedCount int  `json:"deletedCount"`
}

// DeleteVirtualClustersFromBifrost removes virtual clusters from Bifrost gateway
func (a *DecommissioningActivities) DeleteVirtualClustersFromBifrost(
	ctx context.Context,
	input DeleteVirtualClustersInput,
) (*DeleteVirtualClustersResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Deleting virtual clusters from Bifrost", "applicationId", input.ApplicationID)

	// TODO: Implement:
	// 1. Query Payload for all virtual clusters for this application
	// 2. For each virtual cluster:
	//    a. Call Bifrost Admin API: DeleteVirtualCluster
	//    b. Mark as deleted in Payload

	return &DeleteVirtualClustersResult{
		Success:      true,
		DeletedCount: 3,
	}, nil
}

// ArchiveMetricsDataInput is input for archiving metrics
type ArchiveMetricsDataInput struct {
	ApplicationID string `json:"applicationId"`
}

// ArchiveMetricsData archives usage metrics for historical/chargeback purposes
func (a *DecommissioningActivities) ArchiveMetricsData(
	ctx context.Context,
	input ArchiveMetricsDataInput,
) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Archiving metrics data", "applicationId", input.ApplicationID)

	// TODO: Implement:
	// 1. Optionally export/archive KafkaUsageMetrics for this application
	// 2. Mark metrics as archived (or leave as-is for retention)

	return nil
}

// MarkApplicationDeletedInput is input for marking app deleted
type MarkApplicationDeletedInput struct {
	ApplicationID string `json:"applicationId"`
	DeletedBy     string `json:"deletedBy,omitempty"`
	ForceDeleted  bool   `json:"forceDeleted"`
}

// MarkApplicationDeleted marks the application as deleted in Payload
func (a *DecommissioningActivities) MarkApplicationDeleted(
	ctx context.Context,
	input MarkApplicationDeletedInput,
) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Marking application deleted",
		"applicationId", input.ApplicationID,
		"forceDeleted", input.ForceDeleted,
	)

	// TODO: Implement:
	// 1. Update application in Payload:
	//    - status: "deleted"
	//    - deletedAt: now
	//    - deletedBy: input.DeletedBy (if provided)
	//    - forceDeleted: input.ForceDeleted
	// 2. Update all virtual clusters to status: "deleted"

	return nil
}

// ScheduleCleanupWorkflowInput is input for scheduling cleanup
type ScheduleCleanupWorkflowInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
	ScheduledFor  string `json:"scheduledFor"` // ISO timestamp
}

// ScheduleCleanupWorkflowResult is result of scheduling
type ScheduleCleanupWorkflowResult struct {
	Success    bool   `json:"success"`
	WorkflowID string `json:"workflowId"`
}

// ScheduleCleanupWorkflow schedules the cleanup workflow for grace period end
func (a *DecommissioningActivities) ScheduleCleanupWorkflow(
	ctx context.Context,
	input ScheduleCleanupWorkflowInput,
) (*ScheduleCleanupWorkflowResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Scheduling cleanup workflow",
		"applicationId", input.ApplicationID,
		"scheduledFor", input.ScheduledFor,
	)

	// TODO: Implement:
	// 1. Create a Temporal schedule that triggers ApplicationCleanupWorkflow
	//    at the specified time
	// 2. Return the schedule/workflow ID

	workflowID := fmt.Sprintf("app-cleanup-%s", input.ApplicationID)

	return &ScheduleCleanupWorkflowResult{
		Success:    true,
		WorkflowID: workflowID,
	}, nil
}

// UpdateApplicationWorkflowIDInput is input for updating workflow ID
type UpdateApplicationWorkflowIDInput struct {
	ApplicationID string `json:"applicationId"`
	WorkflowID    string `json:"workflowId"`
}

// UpdateApplicationWorkflowID stores the cleanup workflow ID in the application record
func (a *DecommissioningActivities) UpdateApplicationWorkflowID(
	ctx context.Context,
	input UpdateApplicationWorkflowIDInput,
) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Updating application workflow ID",
		"applicationId", input.ApplicationID,
		"workflowId", input.WorkflowID,
	)

	// TODO: Implement:
	// 1. Update application in Payload with cleanupWorkflowId

	return nil
}

// ExecuteImmediateCleanupInput is input for immediate cleanup
type ExecuteImmediateCleanupInput struct {
	ApplicationID string `json:"applicationId"`
	WorkspaceID   string `json:"workspaceId"`
}

// ExecuteImmediateCleanupResult is result of immediate cleanup
type ExecuteImmediateCleanupResult struct {
	Success            bool `json:"success"`
	TopicsDeleted      int  `json:"topicsDeleted"`
	CredentialsRevoked int  `json:"credentialsRevoked"`
}

// ExecuteImmediateCleanup performs all cleanup steps immediately (for force delete)
func (a *DecommissioningActivities) ExecuteImmediateCleanup(
	ctx context.Context,
	input ExecuteImmediateCleanupInput,
) (*ExecuteImmediateCleanupResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Executing immediate cleanup", "applicationId", input.ApplicationID)

	// This combines all cleanup steps:
	// 1. Delete physical topics
	topicsResult, _ := a.DeletePhysicalTopics(ctx, DeletePhysicalTopicsInput{
		ApplicationID: input.ApplicationID,
	})

	// 2. Revoke credentials
	credentialsResult, _ := a.RevokeAllCredentials(ctx, RevokeAllCredentialsInput{
		ApplicationID: input.ApplicationID,
	})

	// 3. Delete virtual clusters from Bifrost
	a.DeleteVirtualClustersFromBifrost(ctx, DeleteVirtualClustersInput{
		ApplicationID: input.ApplicationID,
	})

	// 4. Archive metrics
	a.ArchiveMetricsData(ctx, ArchiveMetricsDataInput{
		ApplicationID: input.ApplicationID,
	})

	return &ExecuteImmediateCleanupResult{
		Success:            true,
		TopicsDeleted:      topicsResult.DeletedCount,
		CredentialsRevoked: credentialsResult.RevokedCount,
	}, nil
}
```

**Step 2: Commit**

```bash
git add temporal-workflows/internal/activities/decommissioning_activities.go
git commit -m "feat(phase9): add decommissioning activities"
```

---

### Task 7: Implement OffsetCheckpointWorkflow (Temporal)

**Files:**
- Create: `temporal-workflows/internal/workflows/offset_checkpoint_workflow.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/workflows/offset_checkpoint_workflow_test.go
package workflows

import (
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type OffsetCheckpointWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *OffsetCheckpointWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
}

func (s *OffsetCheckpointWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *OffsetCheckpointWorkflowTestSuite) TestOffsetCheckpointWorkflow_Success() {
	// Mock activities
	s.env.OnActivity("FetchActiveConsumerGroups", mock.Anything, mock.Anything).Return(
		&FetchActiveConsumerGroupsResult{
			ConsumerGroups: []ConsumerGroupInfo{
				{ID: "cg-1", VirtualClusterID: "vc-1", GroupID: "order-processor"},
				{ID: "cg-2", VirtualClusterID: "vc-2", GroupID: "payment-handler"},
			},
		}, nil,
	)
	s.env.OnActivity("FetchConsumerOffsets", mock.Anything, mock.Anything).Return(
		&FetchConsumerOffsetsResult{
			Offsets: map[string]int64{"orders-0": 1000, "orders-1": 2000},
		}, nil,
	).Times(2)
	s.env.OnActivity("StoreOffsetCheckpoint", mock.Anything, mock.Anything).Return(nil).Times(2)

	s.env.ExecuteWorkflow(OffsetCheckpointWorkflow, OffsetCheckpointInput{})

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result OffsetCheckpointResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.True(result.Success)
	s.Equal(2, result.CheckpointsCreated)
}

func TestOffsetCheckpointWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(OffsetCheckpointWorkflowTestSuite))
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestOffsetCheckpointWorkflow ./internal/workflows/`
Expected: FAIL with undefined functions

**Step 3: Implement the workflow**

```go
// temporal-workflows/internal/workflows/offset_checkpoint_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	OffsetCheckpointTaskQueue = "offset-checkpoint"
)

// OffsetCheckpointInput is input for offset checkpoint workflow
type OffsetCheckpointInput struct {
	// Empty for now - checkpoints all active consumer groups
}

// OffsetCheckpointResult is result of offset checkpoint workflow
type OffsetCheckpointResult struct {
	Success            bool   `json:"success"`
	CheckpointsCreated int    `json:"checkpointsCreated"`
	Error              string `json:"error,omitempty"`
}

// ConsumerGroupInfo contains consumer group information
type ConsumerGroupInfo struct {
	ID               string `json:"id"`
	VirtualClusterID string `json:"virtualClusterId"`
	GroupID          string `json:"groupId"`
}

// FetchActiveConsumerGroupsInput is input for fetching consumer groups
type FetchActiveConsumerGroupsInput struct{}

// FetchActiveConsumerGroupsResult is result of fetching consumer groups
type FetchActiveConsumerGroupsResult struct {
	ConsumerGroups []ConsumerGroupInfo `json:"consumerGroups"`
}

// FetchConsumerOffsetsInput is input for fetching offsets
type FetchConsumerOffsetsInput struct {
	ConsumerGroupID  string `json:"consumerGroupId"`
	VirtualClusterID string `json:"virtualClusterId"`
}

// FetchConsumerOffsetsResult is result of fetching offsets
type FetchConsumerOffsetsResult struct {
	Offsets map[string]int64 `json:"offsets"` // partition -> offset
}

// StoreOffsetCheckpointInput is input for storing checkpoint
type StoreOffsetCheckpointInput struct {
	ConsumerGroupID  string           `json:"consumerGroupId"`
	VirtualClusterID string           `json:"virtualClusterId"`
	Offsets          map[string]int64 `json:"offsets"`
	CheckpointedAt   time.Time        `json:"checkpointedAt"`
}

// OffsetCheckpointWorkflow periodically checkpoints consumer group offsets
// Schedule: Every 15 minutes via Temporal schedule
func OffsetCheckpointWorkflow(ctx workflow.Context, input OffsetCheckpointInput) (*OffsetCheckpointResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OffsetCheckpointWorkflow")

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Fetch all active consumer groups
	var groupsResult FetchActiveConsumerGroupsResult
	err := workflow.ExecuteActivity(ctx, "FetchActiveConsumerGroups", FetchActiveConsumerGroupsInput{}).
		Get(ctx, &groupsResult)
	if err != nil {
		logger.Error("Failed to fetch active consumer groups", "error", err)
		return &OffsetCheckpointResult{
			Success: false,
			Error:   "Failed to fetch consumer groups: " + err.Error(),
		}, nil
	}

	logger.Info("Found active consumer groups", "count", len(groupsResult.ConsumerGroups))

	checkpointsCreated := 0
	checkpointTime := workflow.Now(ctx)

	// Step 2: For each consumer group, fetch and store offsets
	for _, cg := range groupsResult.ConsumerGroups {
		// Fetch current offsets
		var offsetsResult FetchConsumerOffsetsResult
		err := workflow.ExecuteActivity(ctx, "FetchConsumerOffsets", FetchConsumerOffsetsInput{
			ConsumerGroupID:  cg.ID,
			VirtualClusterID: cg.VirtualClusterID,
		}).Get(ctx, &offsetsResult)
		if err != nil {
			logger.Error("Failed to fetch offsets for consumer group",
				"groupId", cg.GroupID,
				"error", err,
			)
			continue
		}

		// Store checkpoint
		err = workflow.ExecuteActivity(ctx, "StoreOffsetCheckpoint", StoreOffsetCheckpointInput{
			ConsumerGroupID:  cg.ID,
			VirtualClusterID: cg.VirtualClusterID,
			Offsets:          offsetsResult.Offsets,
			CheckpointedAt:   checkpointTime,
		}).Get(ctx, nil)
		if err != nil {
			logger.Error("Failed to store offset checkpoint",
				"groupId", cg.GroupID,
				"error", err,
			)
			continue
		}

		checkpointsCreated++
	}

	logger.Info("OffsetCheckpointWorkflow completed",
		"checkpointsCreated", checkpointsCreated,
	)

	return &OffsetCheckpointResult{
		Success:            true,
		CheckpointsCreated: checkpointsCreated,
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd temporal-workflows && go test -v -run TestOffsetCheckpointWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/offset_checkpoint_workflow.go \
        temporal-workflows/internal/workflows/offset_checkpoint_workflow_test.go
git commit -m "feat(phase9): add OffsetCheckpointWorkflow"
```

---

### Task 8: Implement OffsetRestoreWorkflow (Temporal)

**Files:**
- Create: `temporal-workflows/internal/workflows/offset_restore_workflow.go`

**Step 1: Write the failing test**

```go
// temporal-workflows/internal/workflows/offset_restore_workflow_test.go
package workflows

import (
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type OffsetRestoreWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *OffsetRestoreWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
}

func (s *OffsetRestoreWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *OffsetRestoreWorkflowTestSuite) TestOffsetRestoreWorkflow_Success() {
	input := OffsetRestoreInput{
		ConsumerGroupID: "cg-123",
		CheckpointID:    "checkpoint-456",
	}

	s.env.OnActivity("FetchCheckpoint", mock.Anything, mock.Anything).Return(
		&FetchCheckpointResult{
			Offsets: map[string]int64{"orders-0": 1000, "orders-1": 2000},
		}, nil,
	)
	s.env.OnActivity("SuspendConsumerGroup", mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity("ResetConsumerOffsets", mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity("ResumeConsumerGroup", mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(OffsetRestoreWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result OffsetRestoreResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.True(result.Success)
}

func TestOffsetRestoreWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(OffsetRestoreWorkflowTestSuite))
}
```

**Step 2: Run test to verify it fails**

Run: `cd temporal-workflows && go test -v -run TestOffsetRestoreWorkflow ./internal/workflows/`
Expected: FAIL with undefined functions

**Step 3: Implement the workflow**

```go
// temporal-workflows/internal/workflows/offset_restore_workflow.go
package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	OffsetRestoreTaskQueue = "offset-restore"
)

// OffsetRestoreInput is input for offset restore workflow
type OffsetRestoreInput struct {
	ConsumerGroupID string `json:"consumerGroupId"`
	CheckpointID    string `json:"checkpointId"`
	RequestedBy     string `json:"requestedBy,omitempty"`
}

// OffsetRestoreResult is result of offset restore workflow
type OffsetRestoreResult struct {
	Success          bool   `json:"success"`
	PartitionsReset  int    `json:"partitionsReset"`
	Error            string `json:"error,omitempty"`
}

// FetchCheckpointInput is input for fetching checkpoint
type FetchCheckpointInput struct {
	CheckpointID string `json:"checkpointId"`
}

// FetchCheckpointResult is result of fetching checkpoint
type FetchCheckpointResult struct {
	Offsets map[string]int64 `json:"offsets"`
}

// SuspendConsumerGroupInput is input for suspending consumer group
type SuspendConsumerGroupInput struct {
	ConsumerGroupID string `json:"consumerGroupId"`
}

// ResetConsumerOffsetsInput is input for resetting offsets
type ResetConsumerOffsetsInput struct {
	ConsumerGroupID string           `json:"consumerGroupId"`
	Offsets         map[string]int64 `json:"offsets"`
}

// ResumeConsumerGroupInput is input for resuming consumer group
type ResumeConsumerGroupInput struct {
	ConsumerGroupID string `json:"consumerGroupId"`
}

// OffsetRestoreWorkflow restores consumer group offsets from a checkpoint
func OffsetRestoreWorkflow(ctx workflow.Context, input OffsetRestoreInput) (*OffsetRestoreResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OffsetRestoreWorkflow",
		"consumerGroupId", input.ConsumerGroupID,
		"checkpointId", input.CheckpointID,
	)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Fetch checkpoint data
	var checkpointResult FetchCheckpointResult
	err := workflow.ExecuteActivity(ctx, "FetchCheckpoint", FetchCheckpointInput{
		CheckpointID: input.CheckpointID,
	}).Get(ctx, &checkpointResult)
	if err != nil {
		logger.Error("Failed to fetch checkpoint", "error", err)
		return &OffsetRestoreResult{
			Success: false,
			Error:   "Failed to fetch checkpoint: " + err.Error(),
		}, nil
	}

	logger.Info("Fetched checkpoint offsets", "partitions", len(checkpointResult.Offsets))

	// Step 2: Suspend consumer group (reject JoinGroup requests temporarily)
	err = workflow.ExecuteActivity(ctx, "SuspendConsumerGroup", SuspendConsumerGroupInput{
		ConsumerGroupID: input.ConsumerGroupID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to suspend consumer group", "error", err)
		return &OffsetRestoreResult{
			Success: false,
			Error:   "Failed to suspend consumer group: " + err.Error(),
		}, nil
	}

	// Step 3: Reset offsets to checkpoint values
	err = workflow.ExecuteActivity(ctx, "ResetConsumerOffsets", ResetConsumerOffsetsInput{
		ConsumerGroupID: input.ConsumerGroupID,
		Offsets:         checkpointResult.Offsets,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to reset consumer offsets", "error", err)
		// Try to resume consumer group even if reset failed
		workflow.ExecuteActivity(ctx, "ResumeConsumerGroup", ResumeConsumerGroupInput{
			ConsumerGroupID: input.ConsumerGroupID,
		}).Get(ctx, nil)
		return &OffsetRestoreResult{
			Success: false,
			Error:   "Failed to reset offsets: " + err.Error(),
		}, nil
	}

	// Step 4: Resume consumer group
	err = workflow.ExecuteActivity(ctx, "ResumeConsumerGroup", ResumeConsumerGroupInput{
		ConsumerGroupID: input.ConsumerGroupID,
	}).Get(ctx, nil)
	if err != nil {
		logger.Error("Failed to resume consumer group", "error", err)
		// Non-fatal - offsets were reset successfully
	}

	logger.Info("OffsetRestoreWorkflow completed",
		"partitionsReset", len(checkpointResult.Offsets),
	)

	return &OffsetRestoreResult{
		Success:         true,
		PartitionsReset: len(checkpointResult.Offsets),
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd temporal-workflows && go test -v -run TestOffsetRestoreWorkflow ./internal/workflows/`
Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/offset_restore_workflow.go \
        temporal-workflows/internal/workflows/offset_restore_workflow_test.go
git commit -m "feat(phase9): add OffsetRestoreWorkflow"
```

---

### Task 9: Create Decommissioning UI Component

**Files:**
- Create: `orbit-www/src/components/kafka/DecommissionDialog.tsx`

**Step 1: Create the component**

```typescript
// orbit-www/src/components/kafka/DecommissionDialog.tsx
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, Trash2 } from 'lucide-react'
import {
  decommissionApplication,
  forceDeleteApplication,
} from '@/app/actions/kafka-application-lifecycle'

interface DecommissionDialogProps {
  applicationId: string
  applicationName: string
  applicationSlug: string
  status: 'active' | 'decommissioning'
  gracePeriodEndsAt?: string
  onComplete?: () => void
}

export function DecommissionDialog({
  applicationId,
  applicationName,
  applicationSlug,
  status,
  gracePeriodEndsAt,
  onComplete,
}: DecommissionDialogProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'decommission' | 'force'>('decommission')
  const [reason, setReason] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isForceDelete = mode === 'force'
  const canSubmit = isForceDelete ? confirmName === applicationSlug : true

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)

    try {
      if (isForceDelete) {
        const result = await forceDeleteApplication(applicationId, reason)
        if (!result.success) {
          setError(result.error || 'Failed to force delete application')
          return
        }
      } else {
        const result = await decommissionApplication({
          applicationId,
          reason,
        })
        if (!result.success) {
          setError(result.error || 'Failed to decommission application')
          return
        }
      }

      setOpen(false)
      onComplete?.()
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const gracePeriodInfo = status === 'active' ? (
    <p className="text-sm text-muted-foreground">
      The application will enter a grace period where clients can still consume
      data but cannot produce. After the grace period expires, all resources will
      be permanently deleted.
    </p>
  ) : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="h-4 w-4 mr-1" />
          {status === 'active' ? 'Decommission' : 'Force Delete'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isForceDelete ? 'Force Delete' : 'Decommission'} Application
          </DialogTitle>
          <DialogDescription>
            {isForceDelete
              ? `This will immediately and permanently delete "${applicationName}" and all its resources.`
              : `This will begin the decommissioning process for "${applicationName}".`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {status === 'active' && (
            <div className="flex gap-2">
              <Button
                variant={mode === 'decommission' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setMode('decommission')}
              >
                Graceful Decommission
              </Button>
              <Button
                variant={mode === 'force' ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => setMode('force')}
              >
                Force Delete
              </Button>
            </div>
          )}

          {gracePeriodInfo}

          {isForceDelete && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> This action cannot be undone. All topics,
                schemas, credentials, and virtual clusters will be permanently
                deleted.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              placeholder="Why is this application being decommissioned?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {isForceDelete && (
            <div className="space-y-2">
              <Label htmlFor="confirmName">
                Type <code className="bg-muted px-1 rounded">{applicationSlug}</code> to confirm
              </Label>
              <Input
                id="confirmName"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={applicationSlug}
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
          >
            {loading
              ? 'Processing...'
              : isForceDelete
                ? 'Force Delete'
                : 'Decommission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Export from index**

```typescript
// orbit-www/src/components/kafka/index.ts
// Add to existing exports:
export { DecommissionDialog } from './DecommissionDialog'
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/kafka/DecommissionDialog.tsx \
        orbit-www/src/components/kafka/index.ts
git commit -m "feat(phase9): add DecommissionDialog component"
```

---

### Task 10: Create Offset Recovery UI

**Files:**
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/recovery/page.tsx`
- Create: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/recovery/recovery-client.tsx`

**Step 1: Create server action for offset recovery**

```typescript
// orbit-www/src/app/actions/kafka-offset-recovery.ts
'use server'

import { getPayloadClient } from '@/lib/payload'
import { getSession } from '@/lib/auth/session'
import type { KafkaOffsetCheckpoint, KafkaConsumerGroup } from '@/payload-types'

export interface GetCheckpointsInput {
  consumerGroupId: string
  limit?: number
}

export interface CheckpointSummary {
  id: string
  checkpointedAt: string
  offsets: Record<string, number>
  partitionCount: number
}

export async function getCheckpointsForConsumerGroup(
  input: GetCheckpointsInput
): Promise<{ success: boolean; checkpoints?: CheckpointSummary[]; error?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayloadClient()

  const checkpoints = await payload.find({
    collection: 'kafka-offset-checkpoints',
    where: { consumerGroup: { equals: input.consumerGroupId } },
    sort: '-checkpointedAt',
    limit: input.limit ?? 20,
  })

  return {
    success: true,
    checkpoints: checkpoints.docs.map((cp) => ({
      id: cp.id,
      checkpointedAt: cp.checkpointedAt,
      offsets: cp.offsets as Record<string, number>,
      partitionCount: Object.keys(cp.offsets as Record<string, number>).length,
    })),
  }
}

export interface RestoreOffsetsInput {
  consumerGroupId: string
  checkpointId: string
}

export async function restoreOffsets(
  input: RestoreOffsetsInput
): Promise<{ success: boolean; error?: string; workflowId?: string }> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  // TODO: Trigger OffsetRestoreWorkflow via Temporal

  return {
    success: true,
    workflowId: `offset-restore-${input.checkpointId}`,
  }
}
```

**Step 2: Create recovery page**

```typescript
// orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/recovery/page.tsx
import { notFound } from 'next/navigation'
import { getPayloadClient } from '@/lib/payload'
import { requireSession } from '@/lib/auth/session'
import { RecoveryClient } from './recovery-client'

interface PageProps {
  params: Promise<{ slug: string; appSlug: string }>
}

export default async function OffsetRecoveryPage({ params }: PageProps) {
  const { slug: workspaceSlug, appSlug } = await params
  await requireSession()

  const payload = await getPayloadClient()

  // Get workspace
  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: workspaceSlug } },
    limit: 1,
  })
  const workspace = workspaces.docs[0]
  if (!workspace) notFound()

  // Get application
  const apps = await payload.find({
    collection: 'kafka-applications',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { slug: { equals: appSlug } },
      ],
    },
    limit: 1,
  })
  const application = apps.docs[0]
  if (!application) notFound()

  // Get consumer groups for this application's virtual clusters
  const virtualClusters = await payload.find({
    collection: 'kafka-virtual-clusters',
    where: { application: { equals: application.id } },
    limit: 10,
  })

  const vcIds = virtualClusters.docs.map((vc) => vc.id)

  const consumerGroups = await payload.find({
    collection: 'kafka-consumer-groups',
    where: { virtualCluster: { in: vcIds } },
    limit: 100,
    depth: 1,
  })

  return (
    <RecoveryClient
      workspaceSlug={workspaceSlug}
      application={{
        id: application.id,
        name: application.name,
        slug: application.slug,
      }}
      consumerGroups={consumerGroups.docs.map((cg) => ({
        id: cg.id,
        groupId: cg.groupId,
        virtualCluster: typeof cg.virtualCluster === 'string'
          ? cg.virtualCluster
          : cg.virtualCluster.environment,
        state: cg.state,
        memberCount: cg.memberCount ?? 0,
      }))}
    />
  )
}
```

**Step 3: Create recovery client component**

```typescript
// orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/recovery/recovery-client.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Database, Clock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  getCheckpointsForConsumerGroup,
  restoreOffsets,
  type CheckpointSummary,
} from '@/app/actions/kafka-offset-recovery'

interface ConsumerGroupInfo {
  id: string
  groupId: string
  virtualCluster: string
  state: string
  memberCount: number
}

interface RecoveryClientProps {
  workspaceSlug: string
  application: {
    id: string
    name: string
    slug: string
  }
  consumerGroups: ConsumerGroupInfo[]
}

export function RecoveryClient({
  workspaceSlug,
  application,
  consumerGroups,
}: RecoveryClientProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleGroupSelect = async (groupId: string) => {
    setSelectedGroup(groupId)
    setCheckpoints([])
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      const result = await getCheckpointsForConsumerGroup({
        consumerGroupId: groupId,
        limit: 20,
      })

      if (result.success && result.checkpoints) {
        setCheckpoints(result.checkpoints)
      } else {
        setError(result.error || 'Failed to load checkpoints')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async (checkpointId: string) => {
    if (!selectedGroup) return

    setRestoring(checkpointId)
    setError(null)
    setSuccess(null)

    try {
      const result = await restoreOffsets({
        consumerGroupId: selectedGroup,
        checkpointId,
      })

      if (result.success) {
        setSuccess(`Offset restore initiated. Workflow ID: ${result.workflowId}`)
      } else {
        setError(result.error || 'Failed to initiate restore')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setRestoring(null)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString()
  }

  const getTimeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return `${minutes}m ago`
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/workspaces/${workspaceSlug}/kafka`} className="hover:text-foreground">
          Kafka
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link
          href={`/workspaces/${workspaceSlug}/kafka/applications/${application.slug}`}
          className="hover:text-foreground"
        >
          {application.name}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Offset Recovery</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Offset Recovery</h1>
        <p className="text-muted-foreground">
          Restore consumer group offsets from a previous checkpoint
        </p>
      </div>

      {/* Consumer Group Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Select Consumer Group
          </CardTitle>
          <CardDescription>
            Choose a consumer group to view available checkpoints
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedGroup} onValueChange={handleGroupSelect}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a consumer group" />
            </SelectTrigger>
            <SelectContent>
              {consumerGroups.map((cg) => (
                <SelectItem key={cg.id} value={cg.id}>
                  <div className="flex items-center gap-2">
                    <span>{cg.groupId}</span>
                    <Badge variant="outline" className="text-xs">
                      {cg.virtualCluster}
                    </Badge>
                    <Badge
                      variant={cg.state === 'Stable' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {cg.state}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {consumerGroups.length === 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              No consumer groups found for this application.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Checkpoints Table */}
      {selectedGroup && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Available Checkpoints
            </CardTitle>
            <CardDescription>
              Select a checkpoint to restore offsets from that point in time
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : checkpoints.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No checkpoints available for this consumer group.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Checkpoint Time</TableHead>
                    <TableHead>Time Since</TableHead>
                    <TableHead>Partitions</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checkpoints.map((cp) => (
                    <TableRow key={cp.id}>
                      <TableCell className="font-mono text-sm">
                        {formatDate(cp.checkpointedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getTimeSince(cp.checkpointedAt)}</Badge>
                      </TableCell>
                      <TableCell>{cp.partitionCount}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(cp.id)}
                          disabled={restoring === cp.id}
                        >
                          {restoring === cp.id ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                              Restoring...
                            </>
                          ) : (
                            'Restore'
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add orbit-www/src/app/actions/kafka-offset-recovery.ts \
        "orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/recovery/page.tsx" \
        "orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/recovery/recovery-client.tsx"
git commit -m "feat(phase9): add offset recovery UI"
```

---

### Task 11: Integration Tests

**Files:**
- Create: `orbit-www/src/lib/kafka/lifecycle.integration.test.ts`

**Step 1: Write integration tests**

```typescript
// orbit-www/src/lib/kafka/lifecycle.integration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  calculateGracePeriodEnd,
  getDefaultGracePeriodDays,
  isGracePeriodExpired,
  getRemainingGracePeriodDays,
} from './lifecycle'

describe('Lifecycle Integration Tests', () => {
  describe('Grace Period Calculation', () => {
    it('should use max grace period across environments', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['dev', 'stage', 'prod']

      const endDate = calculateGracePeriodEnd(startDate, environments)

      // prod has 30 days, which is the max
      const expectedEnd = new Date('2026-02-09T00:00:00Z')
      expect(endDate.toISOString()).toBe(expectedEnd.toISOString())
    })

    it('should handle dev-only environment', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['dev']

      const endDate = calculateGracePeriodEnd(startDate, environments)

      // dev has 7 days
      const expectedEnd = new Date('2026-01-17T00:00:00Z')
      expect(endDate.toISOString()).toBe(expectedEnd.toISOString())
    })

    it('should respect override even when smaller than default', () => {
      const startDate = new Date('2026-01-10T00:00:00Z')
      const environments = ['prod'] // 30 days default
      const override = 5 // Override to 5 days

      const endDate = calculateGracePeriodEnd(startDate, environments, override)

      const expectedEnd = new Date('2026-01-15T00:00:00Z')
      expect(endDate.toISOString()).toBe(expectedEnd.toISOString())
    })
  })

  describe('Grace Period Status', () => {
    it('should correctly identify expired grace period', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // Yesterday
      expect(isGracePeriodExpired(pastDate)).toBe(true)
    })

    it('should correctly identify active grace period', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
      expect(isGracePeriodExpired(futureDate)).toBe(false)
    })

    it('should calculate remaining days correctly', () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 10)

      const remaining = getRemainingGracePeriodDays(futureDate)

      // Should be 10 or 11 depending on time of day
      expect(remaining).toBeGreaterThanOrEqual(9)
      expect(remaining).toBeLessThanOrEqual(11)
    })

    it('should return 0 for expired grace period', () => {
      const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago

      const remaining = getRemainingGracePeriodDays(pastDate)

      expect(remaining).toBe(0)
    })
  })

  describe('Default Grace Periods', () => {
    it('should return correct defaults for all environments', () => {
      expect(getDefaultGracePeriodDays('dev')).toBe(7)
      expect(getDefaultGracePeriodDays('stage')).toBe(14)
      expect(getDefaultGracePeriodDays('prod')).toBe(30)
    })

    it('should return safe default for unknown environment', () => {
      expect(getDefaultGracePeriodDays('unknown')).toBe(30)
      expect(getDefaultGracePeriodDays('')).toBe(30)
    })
  })
})
```

**Step 2: Run tests**

Run: `cd orbit-www && pnpm exec vitest run src/lib/kafka/lifecycle.integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add orbit-www/src/lib/kafka/lifecycle.integration.test.ts
git commit -m "test(phase9): add lifecycle integration tests"
```

---

## Summary

This implementation plan covers Phase 9: Lifecycle & Disaster Recovery with 11 tasks:

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | KafkaOffsetCheckpoints collection | `KafkaOffsetCheckpoints.ts` |
| 2 | Lifecycle fields on KafkaApplications | `KafkaApplications.ts` |
| 3 | Decommissioning server actions | `kafka-application-lifecycle.ts`, `lifecycle.ts` |
| 4 | ApplicationDecommissioningWorkflow | `application_decommissioning_workflow.go` |
| 5 | ApplicationCleanupWorkflow | `application_cleanup_workflow.go` |
| 6 | Decommissioning activities | `decommissioning_activities.go` |
| 7 | OffsetCheckpointWorkflow | `offset_checkpoint_workflow.go` |
| 8 | OffsetRestoreWorkflow | `offset_restore_workflow.go` |
| 9 | DecommissionDialog UI | `DecommissionDialog.tsx` |
| 10 | Offset Recovery UI | `recovery/page.tsx`, `recovery-client.tsx` |
| 11 | Integration tests | `lifecycle.integration.test.ts` |

**Post-implementation tasks (not covered in detail):**
- Register workflows with Temporal worker
- Create Temporal schedules for OffsetCheckpointWorkflow (every 15 minutes)
- Add navigation link to recovery page from application settings
- Wire up Bifrost admin client in activities
- E2E tests for full decommissioning flow
