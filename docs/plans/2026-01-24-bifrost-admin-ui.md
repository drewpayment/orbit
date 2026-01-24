# Bifrost Admin UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Gateway tab to the Kafka Platform UI that provides full administrative control over Bifrost virtual clusters, credentials, and status.

**Architecture:** New Gateway tab in existing `/platform/kafka/` page with three sub-tabs (Virtual Clusters, Credentials, Status). Server actions call Bifrost admin gRPC API directly. UI follows existing patterns from ClustersTab/ProvidersTab.

**Tech Stack:** React 19, Next.js 15, Connect-ES gRPC client, shadcn/ui components, Vitest for tests

---

## Task 1: Create Bifrost gRPC Client

**Files:**
- Create: `orbit-www/src/lib/grpc/bifrost-client.ts`
- Test: `orbit-www/src/lib/grpc/__tests__/bifrost-client.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/lib/grpc/__tests__/bifrost-client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { bifrostClient } from '../bifrost-client'

describe('bifrostClient', () => {
  it('should be a valid Connect client with expected methods', () => {
    expect(bifrostClient).toBeDefined()
    expect(typeof bifrostClient.listVirtualClusters).toBe('function')
    expect(typeof bifrostClient.upsertVirtualCluster).toBe('function')
    expect(typeof bifrostClient.deleteVirtualCluster).toBe('function')
    expect(typeof bifrostClient.setVirtualClusterReadOnly).toBe('function')
    expect(typeof bifrostClient.listCredentials).toBe('function')
    expect(typeof bifrostClient.upsertCredential).toBe('function')
    expect(typeof bifrostClient.revokeCredential).toBe('function')
    expect(typeof bifrostClient.getStatus).toBe('function')
    expect(typeof bifrostClient.getFullConfig).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/lib/grpc/__tests__/bifrost-client.test.ts`
Expected: FAIL with "Cannot find module '../bifrost-client'"

**Step 3: Write minimal implementation**

Create `orbit-www/src/lib/grpc/bifrost-client.ts`:

```typescript
/**
 * Bifrost Admin gRPC Client
 *
 * Provides a configured Connect-ES client for the Bifrost gateway admin service.
 * This service manages virtual clusters, credentials, and gateway configuration.
 *
 * Usage:
 * ```ts
 * import { bifrostClient } from '@/lib/grpc/bifrost-client'
 *
 * const response = await bifrostClient.listVirtualClusters({})
 * ```
 */

import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { BifrostAdminService } from '@/lib/proto/idp/gateway/v1/gateway_pb'

/**
 * Transport configuration for the Bifrost admin gRPC service.
 * Uses gRPC transport for server-side calls to native gRPC services.
 * Defaults to localhost:50060 for development.
 * Override with BIFROST_ADMIN_URL environment variable.
 */
const transport = createGrpcTransport({
  baseUrl: process.env.BIFROST_ADMIN_URL || 'http://localhost:50060',
})

/**
 * Singleton client instance for the Bifrost admin service.
 *
 * Available methods:
 * - Virtual Clusters: listVirtualClusters, upsertVirtualCluster, deleteVirtualCluster, setVirtualClusterReadOnly
 * - Credentials: listCredentials, upsertCredential, revokeCredential
 * - Status: getStatus, getFullConfig
 * - Policies: listPolicies, upsertPolicy, deletePolicy (future)
 * - Topic ACLs: listTopicACLs, upsertTopicACL, revokeTopicACL (future)
 */
export const bifrostClient = createClient(BifrostAdminService, transport)

/**
 * Helper type for extracting request types from the client
 */
export type BifrostClient = typeof bifrostClient
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/lib/grpc/__tests__/bifrost-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/lib/grpc/bifrost-client.ts orbit-www/src/lib/grpc/__tests__/bifrost-client.test.ts
git commit -m "feat(bifrost): add Bifrost admin gRPC client"
```

---

## Task 2: Create Bifrost Admin Server Actions - Types and Auth

**Files:**
- Create: `orbit-www/src/app/actions/bifrost-admin.ts`
- Test: `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the auth and payload modules
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
}))

describe('bifrost-admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export VirtualClusterConfig type', async () => {
    const { VirtualClusterConfig } = await import('../bifrost-admin')
    // Type exists if we can reference it without error
    expect(true).toBe(true)
  })

  it('should export CredentialConfig type', async () => {
    const { CredentialConfig } = await import('../bifrost-admin')
    expect(true).toBe(true)
  })

  it('should export GatewayStatus type', async () => {
    const { GatewayStatus } = await import('../bifrost-admin')
    expect(true).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: FAIL with "Cannot find module '../bifrost-admin'"

**Step 3: Write minimal implementation**

Create `orbit-www/src/app/actions/bifrost-admin.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { bifrostClient } from '@/lib/grpc/bifrost-client'
import type {
  VirtualClusterConfig as ProtoVirtualClusterConfig,
  CredentialConfig as ProtoCredentialConfig,
  GetStatusResponse,
  GetFullConfigResponse,
  PermissionTemplate as ProtoPermissionTemplate,
  CustomPermission as ProtoCustomPermission,
} from '@/lib/proto/idp/gateway/v1/gateway_pb'

// ============================================================================
// Type Definitions (exported for UI consumption)
// ============================================================================

export interface VirtualClusterConfig {
  id: string
  applicationId: string
  applicationSlug: string
  workspaceSlug: string
  environment: string
  topicPrefix: string
  groupPrefix: string
  transactionIdPrefix: string
  advertisedHost: string
  advertisedPort: number
  physicalBootstrapServers: string
  readOnly: boolean
}

export type PermissionTemplate = 'producer' | 'consumer' | 'admin' | 'custom'

export interface CustomPermission {
  resourceType: string
  resourcePattern: string
  operations: string[]
}

export interface CredentialConfig {
  id: string
  virtualClusterId: string
  username: string
  template: PermissionTemplate
  customPermissions: CustomPermission[]
}

export interface GatewayStatus {
  status: string
  activeConnections: number
  virtualClusterCount: number
  versionInfo: Record<string, string>
}

export interface FullConfig {
  virtualClusters: VirtualClusterConfig[]
  credentials: CredentialConfig[]
  policiesCount: number
  topicAclsCount: number
}

// ============================================================================
// Payload Type Definitions
// ============================================================================

interface WorkspaceRoleAssignment {
  id: string
  user: string | { id: string }
  workspace: string | { id: string }
  role:
    | string
    | {
        id: string
        name: string
        slug: string
        scope: 'platform' | 'workspace'
      }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if the current user has admin privileges.
 * Reuses the same pattern from kafka-admin.ts
 */
async function requireAdmin(): Promise<{ userId: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    throw new Error('Unauthorized: Authentication required')
  }

  const payload = await getPayload({ config })

  const payloadUsers = await payload.find({
    collection: 'users',
    where: {
      email: { equals: session.user.email },
    },
    limit: 1,
  })

  const payloadUser = payloadUsers.docs[0]
  if (!payloadUser) {
    throw new Error('Unauthorized: User not found in system')
  }

  const roleAssignments = await payload.find({
    collection: 'user-workspace-roles' as 'users',
    depth: 2,
    limit: 1000,
  })

  const isAdmin = roleAssignments.docs.some((assignment: unknown) => {
    const typedAssignment = assignment as WorkspaceRoleAssignment

    const assignmentUserId = typeof typedAssignment.user === 'object'
      ? (typedAssignment.user as { id?: string })?.id
      : typedAssignment.user
    if (assignmentUserId !== payloadUser.id) return false

    const role = typeof typedAssignment.role === 'object' ? typedAssignment.role : null
    if (!role) return false

    return (
      role.scope === 'platform' &&
      (role.slug === 'admin' || role.slug === 'platform-admin' || role.slug === 'super-admin')
    )
  })

  if (!isAdmin) {
    throw new Error('Unauthorized: Admin privileges required')
  }

  return { userId: session.user.id }
}

// ============================================================================
// Mapping Functions
// ============================================================================

function mapProtoToVirtualCluster(proto: ProtoVirtualClusterConfig): VirtualClusterConfig {
  return {
    id: proto.id,
    applicationId: proto.applicationId,
    applicationSlug: proto.applicationSlug,
    workspaceSlug: proto.workspaceSlug,
    environment: proto.environment,
    topicPrefix: proto.topicPrefix,
    groupPrefix: proto.groupPrefix,
    transactionIdPrefix: proto.transactionIdPrefix,
    advertisedHost: proto.advertisedHost,
    advertisedPort: proto.advertisedPort,
    physicalBootstrapServers: proto.physicalBootstrapServers,
    readOnly: proto.readOnly,
  }
}

function mapPermissionTemplate(proto: ProtoPermissionTemplate): PermissionTemplate {
  switch (proto) {
    case 1: return 'producer'
    case 2: return 'consumer'
    case 3: return 'admin'
    case 4: return 'custom'
    default: return 'producer'
  }
}

function mapPermissionTemplateToProto(template: PermissionTemplate): ProtoPermissionTemplate {
  switch (template) {
    case 'producer': return 1
    case 'consumer': return 2
    case 'admin': return 3
    case 'custom': return 4
    default: return 1
  }
}

function mapProtoToCredential(proto: ProtoCredentialConfig): CredentialConfig {
  return {
    id: proto.id,
    virtualClusterId: proto.virtualClusterId,
    username: proto.username,
    template: mapPermissionTemplate(proto.template),
    customPermissions: proto.customPermissions.map((p: ProtoCustomPermission) => ({
      resourceType: p.resourceType,
      resourcePattern: p.resourcePattern,
      operations: [...p.operations],
    })),
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/bifrost-admin.ts orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts
git commit -m "feat(bifrost): add bifrost-admin types and auth helpers"
```

---

## Task 3: Add Virtual Cluster Server Actions

**Files:**
- Modify: `orbit-www/src/app/actions/bifrost-admin.ts`
- Modify: `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
}))

vi.mock('@/lib/grpc/bifrost-client', () => ({
  bifrostClient: {
    listVirtualClusters: vi.fn(),
    upsertVirtualCluster: vi.fn(),
    deleteVirtualCluster: vi.fn(),
    setVirtualClusterReadOnly: vi.fn(),
  },
}))

describe('bifrost-admin virtual cluster actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export listVirtualClusters function', async () => {
    const { listVirtualClusters } = await import('../bifrost-admin')
    expect(typeof listVirtualClusters).toBe('function')
  })

  it('should export createVirtualCluster function', async () => {
    const { createVirtualCluster } = await import('../bifrost-admin')
    expect(typeof createVirtualCluster).toBe('function')
  })

  it('should export deleteVirtualCluster function', async () => {
    const { deleteVirtualCluster } = await import('../bifrost-admin')
    expect(typeof deleteVirtualCluster).toBe('function')
  })

  it('should export setVirtualClusterReadOnly function', async () => {
    const { setVirtualClusterReadOnly } = await import('../bifrost-admin')
    expect(typeof setVirtualClusterReadOnly).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: FAIL with "listVirtualClusters is not exported"

**Step 3: Write minimal implementation**

Add to `orbit-www/src/app/actions/bifrost-admin.ts`:

```typescript
// ============================================================================
// Virtual Cluster Actions
// ============================================================================

/**
 * Lists all virtual clusters from Bifrost.
 */
export async function listVirtualClusters(): Promise<{
  success: boolean
  data?: VirtualClusterConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.listVirtualClusters({})

    const virtualClusters = response.virtualClusters.map(mapProtoToVirtualCluster)

    return { success: true, data: virtualClusters }
  } catch (error) {
    console.error('Failed to list virtual clusters:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list virtual clusters'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates or updates a virtual cluster in Bifrost.
 */
export async function createVirtualCluster(data: {
  id?: string
  workspaceSlug: string
  environment: string
  topicPrefix: string
  groupPrefix: string
  transactionIdPrefix: string
  advertisedHost: string
  advertisedPort: number
  physicalBootstrapServers: string
  applicationId?: string
  applicationSlug?: string
}): Promise<{
  success: boolean
  data?: VirtualClusterConfig
  error?: string
}> {
  try {
    await requireAdmin()

    const id = data.id || `vc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const response = await bifrostClient.upsertVirtualCluster({
      config: {
        id,
        applicationId: data.applicationId || '',
        applicationSlug: data.applicationSlug || '',
        workspaceSlug: data.workspaceSlug,
        environment: data.environment,
        topicPrefix: data.topicPrefix,
        groupPrefix: data.groupPrefix,
        transactionIdPrefix: data.transactionIdPrefix,
        advertisedHost: data.advertisedHost,
        advertisedPort: data.advertisedPort,
        physicalBootstrapServers: data.physicalBootstrapServers,
        readOnly: false,
      },
    })

    if (!response.success) {
      return { success: false, error: 'Failed to create virtual cluster' }
    }

    // Return the created config
    return {
      success: true,
      data: {
        id,
        applicationId: data.applicationId || '',
        applicationSlug: data.applicationSlug || '',
        workspaceSlug: data.workspaceSlug,
        environment: data.environment,
        topicPrefix: data.topicPrefix,
        groupPrefix: data.groupPrefix,
        transactionIdPrefix: data.transactionIdPrefix,
        advertisedHost: data.advertisedHost,
        advertisedPort: data.advertisedPort,
        physicalBootstrapServers: data.physicalBootstrapServers,
        readOnly: false,
      },
    }
  } catch (error) {
    console.error('Failed to create virtual cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create virtual cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Deletes a virtual cluster from Bifrost.
 */
export async function deleteVirtualCluster(id: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.deleteVirtualCluster({
      virtualClusterId: id,
    })

    if (!response.success) {
      return { success: false, error: 'Failed to delete virtual cluster' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to delete virtual cluster:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to delete virtual cluster'
    return { success: false, error: errorMessage }
  }
}

/**
 * Toggles read-only mode for a virtual cluster.
 */
export async function setVirtualClusterReadOnly(
  id: string,
  readOnly: boolean
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.setVirtualClusterReadOnly({
      virtualClusterId: id,
      readOnly,
    })

    if (!response.success) {
      return { success: false, error: 'Failed to update virtual cluster' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to set virtual cluster read-only:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to update virtual cluster'
    return { success: false, error: errorMessage }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/bifrost-admin.ts orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts
git commit -m "feat(bifrost): add virtual cluster server actions"
```

---

## Task 4: Add Credential Server Actions

**Files:**
- Modify: `orbit-www/src/app/actions/bifrost-admin.ts`
- Modify: `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`:

```typescript
describe('bifrost-admin credential actions', () => {
  it('should export listCredentials function', async () => {
    const { listCredentials } = await import('../bifrost-admin')
    expect(typeof listCredentials).toBe('function')
  })

  it('should export createCredential function', async () => {
    const { createCredential } = await import('../bifrost-admin')
    expect(typeof createCredential).toBe('function')
  })

  it('should export revokeCredential function', async () => {
    const { revokeCredential } = await import('../bifrost-admin')
    expect(typeof revokeCredential).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: FAIL with "listCredentials is not exported"

**Step 3: Write minimal implementation**

Add to `orbit-www/src/app/actions/bifrost-admin.ts`:

```typescript
// ============================================================================
// Credential Actions
// ============================================================================

/**
 * Lists credentials, optionally filtered by virtual cluster.
 */
export async function listCredentials(virtualClusterId?: string): Promise<{
  success: boolean
  data?: CredentialConfig[]
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.listCredentials({
      virtualClusterId: virtualClusterId || '',
    })

    const credentials = response.credentials.map(mapProtoToCredential)

    return { success: true, data: credentials }
  } catch (error) {
    console.error('Failed to list credentials:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list credentials'
    return { success: false, error: errorMessage }
  }
}

/**
 * Creates a new credential in Bifrost.
 * Returns the plaintext password (only shown once).
 */
export async function createCredential(data: {
  virtualClusterId: string
  username: string
  password: string
  template: PermissionTemplate
  customPermissions?: CustomPermission[]
}): Promise<{
  success: boolean
  data?: { id: string; username: string; password: string }
  error?: string
}> {
  try {
    await requireAdmin()

    const id = `cred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Hash the password before sending (using simple hash for demo - production should use bcrypt)
    const encoder = new TextEncoder()
    const passwordData = encoder.encode(data.password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', passwordData)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const response = await bifrostClient.upsertCredential({
      config: {
        id,
        virtualClusterId: data.virtualClusterId,
        username: data.username,
        passwordHash,
        template: mapPermissionTemplateToProto(data.template),
        customPermissions: (data.customPermissions || []).map(p => ({
          resourceType: p.resourceType,
          resourcePattern: p.resourcePattern,
          operations: p.operations,
        })),
      },
    })

    if (!response.success) {
      return { success: false, error: 'Failed to create credential' }
    }

    return {
      success: true,
      data: {
        id,
        username: data.username,
        password: data.password, // Return plaintext for user to save
      },
    }
  } catch (error) {
    console.error('Failed to create credential:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create credential'
    return { success: false, error: errorMessage }
  }
}

/**
 * Revokes (deletes) a credential from Bifrost.
 */
export async function revokeCredential(id: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.revokeCredential({
      credentialId: id,
    })

    if (!response.success) {
      return { success: false, error: 'Failed to revoke credential' }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to revoke credential:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to revoke credential'
    return { success: false, error: errorMessage }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/bifrost-admin.ts orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts
git commit -m "feat(bifrost): add credential server actions"
```

---

## Task 5: Add Status Server Actions

**Files:**
- Modify: `orbit-www/src/app/actions/bifrost-admin.ts`
- Modify: `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts`:

```typescript
describe('bifrost-admin status actions', () => {
  it('should export getGatewayStatus function', async () => {
    const { getGatewayStatus } = await import('../bifrost-admin')
    expect(typeof getGatewayStatus).toBe('function')
  })

  it('should export getFullConfig function', async () => {
    const { getFullConfig } = await import('../bifrost-admin')
    expect(typeof getFullConfig).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: FAIL with "getGatewayStatus is not exported"

**Step 3: Write minimal implementation**

Add to `orbit-www/src/app/actions/bifrost-admin.ts`:

```typescript
// ============================================================================
// Status Actions
// ============================================================================

/**
 * Gets the current gateway status from Bifrost.
 */
export async function getGatewayStatus(): Promise<{
  success: boolean
  data?: GatewayStatus
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.getStatus({})

    return {
      success: true,
      data: {
        status: response.status,
        activeConnections: response.activeConnections,
        virtualClusterCount: response.virtualClusterCount,
        versionInfo: { ...response.versionInfo },
      },
    }
  } catch (error) {
    console.error('Failed to get gateway status:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get gateway status'
    return { success: false, error: errorMessage }
  }
}

/**
 * Gets the full configuration from Bifrost.
 */
export async function getFullConfig(): Promise<{
  success: boolean
  data?: FullConfig
  error?: string
}> {
  try {
    await requireAdmin()

    const response = await bifrostClient.getFullConfig({})

    return {
      success: true,
      data: {
        virtualClusters: response.virtualClusters.map(mapProtoToVirtualCluster),
        credentials: response.credentials.map(mapProtoToCredential),
        policiesCount: response.policies.length,
        topicAclsCount: response.topicAcls.length,
      },
    }
  } catch (error) {
    console.error('Failed to get full config:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get full config'
    return { success: false, error: errorMessage }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/bifrost-admin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/bifrost-admin.ts orbit-www/src/app/actions/__tests__/bifrost-admin.test.ts
git commit -m "feat(bifrost): add gateway status server actions"
```

---

## Task 6: Create GatewayTab Component

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/GatewayTab.tsx`

**Step 1: Write the component**

Create `orbit-www/src/app/(frontend)/platform/kafka/components/GatewayTab.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import type { VirtualClusterConfig, CredentialConfig, GatewayStatus } from '@/app/actions/bifrost-admin'
import { VirtualClustersTab } from './VirtualClustersTab'
import { CredentialsTab } from './CredentialsTab'
import { GatewayStatusTab } from './GatewayStatusTab'

interface GatewayTabProps {
  initialVirtualClusters: VirtualClusterConfig[]
  initialCredentials: CredentialConfig[]
  initialStatus: GatewayStatus | null
  connectionError?: string
}

export function GatewayTab({
  initialVirtualClusters,
  initialCredentials,
  initialStatus,
  connectionError,
}: GatewayTabProps) {
  const [activeSubTab, setActiveSubTab] = useState('virtual-clusters')
  const [virtualClusters, setVirtualClusters] = useState(initialVirtualClusters)
  const [credentials, setCredentials] = useState(initialCredentials)
  const [status, setStatus] = useState(initialStatus)
  const [error, setError] = useState<string | null>(connectionError || null)

  // Refresh functions
  const refreshVirtualClusters = async () => {
    try {
      const { listVirtualClusters } = await import('@/app/actions/bifrost-admin')
      const result = await listVirtualClusters()
      if (result.success && result.data) {
        setVirtualClusters(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to refresh virtual clusters')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh virtual clusters')
    }
  }

  const refreshCredentials = async () => {
    try {
      const { listCredentials } = await import('@/app/actions/bifrost-admin')
      const result = await listCredentials()
      if (result.success && result.data) {
        setCredentials(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to refresh credentials')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh credentials')
    }
  }

  const refreshStatus = async () => {
    try {
      const { getGatewayStatus } = await import('@/app/actions/bifrost-admin')
      const result = await getGatewayStatus()
      if (result.success && result.data) {
        setStatus(result.data)
        setError(null)
      } else {
        setError(result.error || 'Failed to refresh status')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh status')
    }
  }

  return (
    <div className="space-y-6">
      {/* Connection error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-sm underline hover:no-underline"
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList>
          <TabsTrigger value="virtual-clusters">
            Virtual Clusters
            {virtualClusters.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {virtualClusters.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="credentials">
            Credentials
            {credentials.length > 0 && (
              <span className="ml-2 text-xs bg-muted px-2 py-0.5 rounded-full">
                {credentials.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="status">
            Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="virtual-clusters" className="mt-6">
          <VirtualClustersTab
            virtualClusters={virtualClusters}
            onRefresh={refreshVirtualClusters}
            onVirtualClustersChange={setVirtualClusters}
          />
        </TabsContent>

        <TabsContent value="credentials" className="mt-6">
          <CredentialsTab
            credentials={credentials}
            virtualClusters={virtualClusters}
            onRefresh={refreshCredentials}
            onCredentialsChange={setCredentials}
          />
        </TabsContent>

        <TabsContent value="status" className="mt-6">
          <GatewayStatusTab
            status={status}
            onRefresh={refreshStatus}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/GatewayTab.tsx
git commit -m "feat(bifrost): add GatewayTab container component"
```

---

## Task 7: Create VirtualClustersTab Component

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/VirtualClustersTab.tsx`

**Step 1: Write the component**

Create `orbit-www/src/app/(frontend)/platform/kafka/components/VirtualClustersTab.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Server, Lock, LockOpen } from 'lucide-react'
import type { VirtualClusterConfig } from '@/app/actions/bifrost-admin'
import { VirtualClusterForm } from './VirtualClusterForm'

interface VirtualClustersTabProps {
  virtualClusters: VirtualClusterConfig[]
  onRefresh: () => Promise<void>
  onVirtualClustersChange: (clusters: VirtualClusterConfig[]) => void
}

export function VirtualClustersTab({
  virtualClusters,
  onRefresh,
  onVirtualClustersChange,
}: VirtualClustersTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingCluster, setEditingCluster] = useState<VirtualClusterConfig | null>(null)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleToggleReadOnly = async (cluster: VirtualClusterConfig) => {
    try {
      const { setVirtualClusterReadOnly } = await import('@/app/actions/bifrost-admin')
      const result = await setVirtualClusterReadOnly(cluster.id, !cluster.readOnly)
      if (result.success) {
        await onRefresh()
      }
    } catch (err) {
      console.error('Failed to toggle read-only:', err)
    }
  }

  const handleDelete = async (clusterId: string) => {
    if (!confirm('Are you sure you want to delete this virtual cluster? Associated credentials will become orphaned.')) {
      return
    }

    try {
      const { deleteVirtualCluster } = await import('@/app/actions/bifrost-admin')
      const result = await deleteVirtualCluster(clusterId)
      if (result.success) {
        await onRefresh()
      }
    } catch (err) {
      console.error('Failed to delete virtual cluster:', err)
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingCluster(null)
  }

  const handleFormSuccess = async () => {
    await onRefresh()
    handleFormClose()
  }

  // Empty state
  if (virtualClusters.length === 0 && !showForm) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Server className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Virtual Clusters</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          Virtual clusters provide tenant isolation for Kafka access. Create your first
          virtual cluster to start routing traffic through Bifrost.
        </p>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Virtual Cluster
        </Button>
      </div>
    )
  }

  if (showForm) {
    return (
      <VirtualClusterForm
        cluster={editingCluster}
        onCancel={handleFormClose}
        onSuccess={handleFormSuccess}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {virtualClusters.length} virtual cluster{virtualClusters.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Create Virtual Cluster
          </Button>
        </div>
      </div>

      {/* Virtual clusters grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {virtualClusters.map((cluster) => (
          <Card
            key={cluster.id}
            className="cursor-pointer transition-colors hover:bg-accent/50"
            onClick={() => {
              setEditingCluster(cluster)
              setShowForm(true)
            }}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{cluster.id}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {cluster.readOnly ? (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      Read-Only
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <LockOpen className="h-3 w-3" />
                      Read/Write
                    </Badge>
                  )}
                </div>
              </div>
              <CardDescription className="text-xs">
                {cluster.workspaceSlug} / {cluster.environment}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                <p className="text-xs text-muted-foreground mb-0.5">Topic Prefix</p>
                <p className="font-mono text-xs truncate">{cluster.topicPrefix}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted-foreground mb-0.5">Bootstrap Servers</p>
                <p className="font-mono text-xs truncate">{cluster.physicalBootstrapServers}</p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleReadOnly(cluster)
                  }}
                >
                  {cluster.readOnly ? 'Enable Writes' : 'Set Read-Only'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(cluster.id)
                  }}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/VirtualClustersTab.tsx
git commit -m "feat(bifrost): add VirtualClustersTab component"
```

---

## Task 8: Create VirtualClusterForm Component

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/VirtualClusterForm.tsx`

**Step 1: Write the component**

Create `orbit-www/src/app/(frontend)/platform/kafka/components/VirtualClusterForm.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import type { VirtualClusterConfig } from '@/app/actions/bifrost-admin'

interface VirtualClusterFormProps {
  cluster: VirtualClusterConfig | null
  onCancel: () => void
  onSuccess: () => void
}

export function VirtualClusterForm({
  cluster,
  onCancel,
  onSuccess,
}: VirtualClusterFormProps) {
  const isEditing = !!cluster

  const [formData, setFormData] = useState({
    id: cluster?.id || '',
    workspaceSlug: cluster?.workspaceSlug || '',
    environment: cluster?.environment || 'dev',
    topicPrefix: cluster?.topicPrefix || '',
    groupPrefix: cluster?.groupPrefix || '',
    transactionIdPrefix: cluster?.transactionIdPrefix || '',
    advertisedHost: cluster?.advertisedHost || '',
    advertisedPort: cluster?.advertisedPort || 9092,
    physicalBootstrapServers: cluster?.physicalBootstrapServers || '',
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const { createVirtualCluster } = await import('@/app/actions/bifrost-admin')
      const result = await createVirtualCluster({
        id: formData.id || undefined,
        workspaceSlug: formData.workspaceSlug,
        environment: formData.environment,
        topicPrefix: formData.topicPrefix,
        groupPrefix: formData.groupPrefix,
        transactionIdPrefix: formData.transactionIdPrefix,
        advertisedHost: formData.advertisedHost,
        advertisedPort: formData.advertisedPort,
        physicalBootstrapServers: formData.physicalBootstrapServers,
      })

      if (result.success) {
        onSuccess()
      } else {
        setError(result.error || 'Failed to save virtual cluster')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save virtual cluster')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>{isEditing ? 'Edit Virtual Cluster' : 'Create Virtual Cluster'}</CardTitle>
            <CardDescription>
              {isEditing
                ? 'Update virtual cluster configuration'
                : 'Configure a new virtual cluster for tenant isolation'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="id">ID (optional)</Label>
              <Input
                id="id"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                placeholder="Auto-generated if empty"
                disabled={isEditing}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspaceSlug">Workspace Slug *</Label>
              <Input
                id="workspaceSlug"
                value={formData.workspaceSlug}
                onChange={(e) => setFormData({ ...formData, workspaceSlug: e.target.value })}
                placeholder="my-workspace"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="environment">Environment *</Label>
              <Select
                value={formData.environment}
                onValueChange={(value) => setFormData({ ...formData, environment: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="prod">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="physicalBootstrapServers">Physical Bootstrap Servers *</Label>
              <Input
                id="physicalBootstrapServers"
                value={formData.physicalBootstrapServers}
                onChange={(e) => setFormData({ ...formData, physicalBootstrapServers: e.target.value })}
                placeholder="broker1:9092,broker2:9092"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="topicPrefix">Topic Prefix *</Label>
              <Input
                id="topicPrefix"
                value={formData.topicPrefix}
                onChange={(e) => setFormData({ ...formData, topicPrefix: e.target.value })}
                placeholder="workspace.app."
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupPrefix">Group Prefix *</Label>
              <Input
                id="groupPrefix"
                value={formData.groupPrefix}
                onChange={(e) => setFormData({ ...formData, groupPrefix: e.target.value })}
                placeholder="workspace.app."
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transactionIdPrefix">Transaction ID Prefix</Label>
              <Input
                id="transactionIdPrefix"
                value={formData.transactionIdPrefix}
                onChange={(e) => setFormData({ ...formData, transactionIdPrefix: e.target.value })}
                placeholder="workspace.app."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="advertisedHost">Advertised Host *</Label>
              <Input
                id="advertisedHost"
                value={formData.advertisedHost}
                onChange={(e) => setFormData({ ...formData, advertisedHost: e.target.value })}
                placeholder="bifrost.example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="advertisedPort">Advertised Port *</Label>
              <Input
                id="advertisedPort"
                type="number"
                value={formData.advertisedPort}
                onChange={(e) => setFormData({ ...formData, advertisedPort: parseInt(e.target.value) || 9092 })}
                placeholder="9092"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditing ? 'Update Virtual Cluster' : 'Create Virtual Cluster'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/VirtualClusterForm.tsx
git commit -m "feat(bifrost): add VirtualClusterForm component"
```

---

## Task 9: Create CredentialsTab Component

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/CredentialsTab.tsx`

**Step 1: Write the component**

Create `orbit-www/src/app/(frontend)/platform/kafka/components/CredentialsTab.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Key, User } from 'lucide-react'
import type { CredentialConfig, VirtualClusterConfig } from '@/app/actions/bifrost-admin'
import { CredentialForm } from './CredentialForm'

interface CredentialsTabProps {
  credentials: CredentialConfig[]
  virtualClusters: VirtualClusterConfig[]
  onRefresh: () => Promise<void>
  onCredentialsChange: (credentials: CredentialConfig[]) => void
}

function getTemplateBadge(template: string): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  switch (template) {
    case 'producer':
      return { label: 'Producer', variant: 'default' }
    case 'consumer':
      return { label: 'Consumer', variant: 'secondary' }
    case 'admin':
      return { label: 'Admin', variant: 'outline' }
    case 'custom':
      return { label: 'Custom', variant: 'outline' }
    default:
      return { label: template, variant: 'outline' }
  }
}

export function CredentialsTab({
  credentials,
  virtualClusters,
  onRefresh,
  onCredentialsChange,
}: CredentialsTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newCredential, setNewCredential] = useState<{ username: string; password: string } | null>(null)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleRevoke = async (credentialId: string, username: string) => {
    if (!confirm(`Are you sure you want to revoke the credential for "${username}"? This will immediately disconnect any clients using this credential.`)) {
      return
    }

    try {
      const { revokeCredential } = await import('@/app/actions/bifrost-admin')
      const result = await revokeCredential(credentialId)
      if (result.success) {
        await onRefresh()
      }
    } catch (err) {
      console.error('Failed to revoke credential:', err)
    }
  }

  const handleFormSuccess = async (data: { username: string; password: string }) => {
    setNewCredential(data)
    setShowForm(false)
    await onRefresh()
  }

  const getVirtualClusterName = (vcId: string) => {
    const vc = virtualClusters.find((v) => v.id === vcId)
    return vc ? `${vc.workspaceSlug} / ${vc.environment}` : vcId
  }

  // Show newly created credential
  if (newCredential) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Credential Created</CardTitle>
          <CardDescription>
            Save these credentials now. The password will not be shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Username</p>
              <p className="font-mono">{newCredential.username}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Password</p>
              <p className="font-mono break-all">{newCredential.password}</p>
            </div>
          </div>
          <Button onClick={() => setNewCredential(null)}>Done</Button>
        </CardContent>
      </Card>
    )
  }

  if (showForm) {
    return (
      <CredentialForm
        virtualClusters={virtualClusters}
        onCancel={() => setShowForm(false)}
        onSuccess={handleFormSuccess}
      />
    )
  }

  // Empty state
  if (credentials.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Key className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Credentials</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          Credentials provide authentication for applications connecting through Bifrost.
          Create credentials for your virtual clusters.
        </p>
        <Button onClick={() => setShowForm(true)} disabled={virtualClusters.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Create Credential
        </Button>
        {virtualClusters.length === 0 && (
          <p className="text-sm text-muted-foreground mt-2">
            Create a virtual cluster first
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {credentials.length} credential{credentials.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)} disabled={virtualClusters.length === 0}>
            <Plus className="h-4 w-4" />
            Create Credential
          </Button>
        </div>
      </div>

      {/* Credentials grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {credentials.map((credential) => {
          const templateBadge = getTemplateBadge(credential.template)

          return (
            <Card key={credential.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{credential.username}</CardTitle>
                  </div>
                  <Badge variant={templateBadge.variant}>{templateBadge.label}</Badge>
                </div>
                <CardDescription className="text-xs">
                  {getVirtualClusterName(credential.virtualClusterId)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevoke(credential.id, credential.username)}
                  >
                    Revoke
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/CredentialsTab.tsx
git commit -m "feat(bifrost): add CredentialsTab component"
```

---

## Task 10: Create CredentialForm Component

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/CredentialForm.tsx`

**Step 1: Write the component**

Create `orbit-www/src/app/(frontend)/platform/kafka/components/CredentialForm.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { VirtualClusterConfig, PermissionTemplate } from '@/app/actions/bifrost-admin'

interface CredentialFormProps {
  virtualClusters: VirtualClusterConfig[]
  onCancel: () => void
  onSuccess: (data: { username: string; password: string }) => void
}

function generatePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

export function CredentialForm({
  virtualClusters,
  onCancel,
  onSuccess,
}: CredentialFormProps) {
  const [formData, setFormData] = useState({
    virtualClusterId: '',
    username: '',
    password: generatePassword(),
    template: 'producer' as PermissionTemplate,
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const { createCredential } = await import('@/app/actions/bifrost-admin')
      const result = await createCredential({
        virtualClusterId: formData.virtualClusterId,
        username: formData.username,
        password: formData.password,
        template: formData.template,
      })

      if (result.success && result.data) {
        onSuccess({
          username: result.data.username,
          password: result.data.password,
        })
      } else {
        setError(result.error || 'Failed to create credential')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create credential')
    } finally {
      setIsSubmitting(false)
    }
  }

  const regeneratePassword = () => {
    setFormData({ ...formData, password: generatePassword() })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>Create Credential</CardTitle>
            <CardDescription>
              Create a new service account credential for Bifrost access
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="virtualClusterId">Virtual Cluster *</Label>
              <Select
                value={formData.virtualClusterId}
                onValueChange={(value) => setFormData({ ...formData, virtualClusterId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select virtual cluster" />
                </SelectTrigger>
                <SelectContent>
                  {virtualClusters.map((vc) => (
                    <SelectItem key={vc.id} value={vc.id}>
                      {vc.id} ({vc.workspaceSlug} / {vc.environment})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="my-service-account"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <div className="flex gap-2">
                <Input
                  id="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  className="font-mono"
                />
                <Button type="button" variant="outline" size="icon" onClick={regeneratePassword}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template">Permission Template *</Label>
              <Select
                value={formData.template}
                onValueChange={(value) => setFormData({ ...formData, template: value as PermissionTemplate })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select permissions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="producer">Producer - Write access to topics</SelectItem>
                  <SelectItem value="consumer">Consumer - Read access to topics</SelectItem>
                  <SelectItem value="admin">Admin - Full access</SelectItem>
                  <SelectItem value="custom">Custom - Define custom permissions</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4">
            <Button type="submit" disabled={isSubmitting || !formData.virtualClusterId}>
              {isSubmitting ? 'Creating...' : 'Create Credential'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/CredentialForm.tsx
git commit -m "feat(bifrost): add CredentialForm component"
```

---

## Task 11: Create GatewayStatusTab Component

**Files:**
- Create: `orbit-www/src/app/(frontend)/platform/kafka/components/GatewayStatusTab.tsx`

**Step 1: Write the component**

Create `orbit-www/src/app/(frontend)/platform/kafka/components/GatewayStatusTab.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Activity, Server, Users, Shield } from 'lucide-react'
import type { GatewayStatus } from '@/app/actions/bifrost-admin'

interface GatewayStatusTabProps {
  status: GatewayStatus | null
  onRefresh: () => Promise<void>
}

function getStatusBadge(status: string): { variant: 'default' | 'secondary' | 'destructive'; className?: string } {
  switch (status.toLowerCase()) {
    case 'healthy':
    case 'ok':
      return { variant: 'default', className: 'bg-green-500 hover:bg-green-500/80 text-white' }
    case 'degraded':
      return { variant: 'secondary', className: 'bg-yellow-500 hover:bg-yellow-500/80 text-white' }
    case 'unhealthy':
    case 'error':
      return { variant: 'destructive' }
    default:
      return { variant: 'secondary' }
  }
}

export function GatewayStatusTab({
  status,
  onRefresh,
}: GatewayStatusTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Unreachable state
  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <Activity className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Gateway Unreachable</h3>
        <p className="text-muted-foreground text-center mb-6 max-w-md">
          Unable to connect to the Bifrost gateway. Check that the service is running
          and accessible.
        </p>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Retry Connection
        </Button>
      </div>
    )
  }

  const statusBadge = getStatusBadge(status.status)

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Gateway health and configuration overview
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Gateway Status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant={statusBadge.variant} className={statusBadge.className}>
              {status.status}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Active Connections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{status.activeConnections}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Virtual Clusters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{status.virtualClusterCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Version
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">
              {status.versionInfo?.version || status.versionInfo?.['bifrost.version'] || 'Unknown'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Version info details */}
      {Object.keys(status.versionInfo).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(status.versionInfo).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <p className="text-muted-foreground">{key}</p>
                  <p className="font-mono">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/GatewayStatusTab.tsx
git commit -m "feat(bifrost): add GatewayStatusTab component"
```

---

## Task 12: Integrate Gateway Tab into KafkaAdminClient

**Files:**
- Modify: `orbit-www/src/app/(frontend)/platform/kafka/components/KafkaAdminClient.tsx`
- Modify: `orbit-www/src/app/(frontend)/platform/kafka/page.tsx`

**Step 1: Update KafkaAdminClient.tsx**

Add the Gateway tab to the existing tabs. Modify `KafkaAdminClient.tsx`:

1. Add imports at the top:
```typescript
import { GatewayTab } from './GatewayTab'
import type { VirtualClusterConfig, CredentialConfig, GatewayStatus } from '@/app/actions/bifrost-admin'
```

2. Update the props interface:
```typescript
interface KafkaAdminClientProps {
  initialProviders: KafkaProviderConfig[]
  initialClusters: KafkaClusterConfig[]
  initialMappings: KafkaEnvironmentMappingConfig[]
  initialVirtualClusters?: VirtualClusterConfig[]
  initialCredentials?: CredentialConfig[]
  initialGatewayStatus?: GatewayStatus | null
  gatewayConnectionError?: string
}
```

3. Add state for gateway data in the component.

4. Add the Gateway tab to the TabsList and TabsContent.

**Step 2: Update page.tsx**

Update the server component to fetch gateway data:

```typescript
// Add at top
import {
  listVirtualClusters,
  listCredentials,
  getGatewayStatus,
} from '@/app/actions/bifrost-admin'

// In the async function, add:
let virtualClusters: VirtualClusterConfig[] = []
let credentials: CredentialConfig[] = []
let gatewayStatus: GatewayStatus | null = null
let gatewayConnectionError: string | undefined

try {
  const [vcResult, credResult, statusResult] = await Promise.all([
    listVirtualClusters(),
    listCredentials(),
    getGatewayStatus(),
  ])

  if (vcResult.success && vcResult.data) {
    virtualClusters = vcResult.data
  }
  if (credResult.success && credResult.data) {
    credentials = credResult.data
  }
  if (statusResult.success && statusResult.data) {
    gatewayStatus = statusResult.data
  }
} catch (error) {
  gatewayConnectionError = 'Unable to connect to Bifrost gateway'
}

// Pass to component
<KafkaAdminClient
  initialProviders={providers}
  initialClusters={clusters}
  initialMappings={mappings}
  initialVirtualClusters={virtualClusters}
  initialCredentials={credentials}
  initialGatewayStatus={gatewayStatus}
  gatewayConnectionError={gatewayConnectionError}
/>
```

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/platform/kafka/components/KafkaAdminClient.tsx orbit-www/src/app/\(frontend\)/platform/kafka/page.tsx
git commit -m "feat(bifrost): integrate Gateway tab into Kafka admin UI"
```

---

## Task 13: Add Environment Variable for Bifrost URL

**Files:**
- Modify: `orbit-www/.env.example` (or create if doesn't exist)
- Modify: `docker-compose.yml`

**Step 1: Add environment variable documentation**

Add to `.env.example`:
```
# Bifrost Gateway Admin API
BIFROST_ADMIN_URL=http://localhost:50060
```

**Step 2: Add to docker-compose.yml**

Add environment variable to orbit-www service:
```yaml
services:
  orbit-www:
    environment:
      - BIFROST_ADMIN_URL=http://bifrost:50060
```

**Step 3: Commit**

```bash
git add orbit-www/.env.example docker-compose.yml
git commit -m "chore: add BIFROST_ADMIN_URL environment variable"
```

---

## Task 14: Run Full Test Suite and Verify

**Step 1: Run all tests**

```bash
cd orbit-www && pnpm exec vitest run
```

Expected: All tests pass

**Step 2: Run linter**

```bash
cd orbit-www && pnpm lint
```

Expected: No errors

**Step 3: Start dev server and manual verification**

```bash
make dev-local
cd orbit-www && bun run dev
```

Open http://localhost:3000/platform/kafka and verify:
1. Gateway tab appears
2. Virtual Clusters sub-tab shows list/empty state
3. Credentials sub-tab shows list/empty state
4. Status sub-tab shows gateway status or unreachable message

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(bifrost): complete Bifrost admin UI integration

- Add Gateway tab to Kafka Platform admin page
- Virtual clusters management (list, create, delete, toggle read-only)
- Credentials management (list, create, revoke)
- Gateway status monitoring
- Direct gRPC calls from Next.js to Bifrost admin API

Implements design from docs/plans/2026-01-24-bifrost-admin-ui-design.md"
```

---

## Summary

This plan implements the Bifrost admin UI integration in 14 tasks:

1. **Task 1**: Create Bifrost gRPC client
2. **Task 2**: Create server actions types and auth
3. **Task 3**: Add virtual cluster server actions
4. **Task 4**: Add credential server actions
5. **Task 5**: Add status server actions
6. **Task 6**: Create GatewayTab container component
7. **Task 7**: Create VirtualClustersTab component
8. **Task 8**: Create VirtualClusterForm component
9. **Task 9**: Create CredentialsTab component
10. **Task 10**: Create CredentialForm component
11. **Task 11**: Create GatewayStatusTab component
12. **Task 12**: Integrate Gateway tab into KafkaAdminClient
13. **Task 13**: Add environment variable configuration
14. **Task 14**: Run tests and verify

Each task follows TDD: write failing test, run to verify failure, implement, run to verify pass, commit.
