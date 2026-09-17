import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

// Mock payload config
vi.mock('@payload-config', () => ({
  default: {},
}))

// Mock @/lib/authz at the module boundary (do not import the real actor.ts;
// it pulls in the Better-Auth Mongo client).
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
}))

// Mock Temporal client
vi.mock('@/lib/temporal/client', () => ({
  getTemporalClient: vi.fn(),
}))

// Mock WorkflowExecutionAlreadyStartedError
vi.mock('@temporalio/client', () => ({
  WorkflowExecutionAlreadyStartedError: class WorkflowExecutionAlreadyStartedError extends Error {
    readonly workflowId: string
    readonly workflowType: string
    constructor(message: string, workflowId: string, workflowType: string) {
      super(message)
      this.name = 'WorkflowExecutionAlreadyStartedError'
      this.workflowId = workflowId
      this.workflowType = workflowType
    }
  },
}))

// Mock password generation utilities
vi.mock('@/collections/kafka/KafkaServiceAccounts', () => ({
  generateSecurePassword: vi.fn(() => 'generated-password-123'),
  hashPassword: vi.fn((password: string) => `hashed-${password}`),
  generateServiceAccountUsername: vi.fn(
    (workspaceSlug: string, appSlug: string, env: string, name: string) =>
      `${workspaceSlug}.${appSlug}.${env}.${name}`
  ),
}))

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import { getTemporalClient } from '@/lib/temporal/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import {
  createServiceAccount,
  rotateServiceAccountPassword,
  revokeServiceAccount,
  listServiceAccounts,
} from './kafka-service-accounts'

// Helper to create mock payload
function createMockPayload(overrides: Record<string, unknown> = {}) {
  return {
    findByID: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  }
}

// Helper to create mock Temporal client
function createMockTemporalClient(workflowStartResult?: unknown) {
  return {
    workflow: {
      start: vi.fn().mockResolvedValue(workflowStartResult ?? { workflowId: 'test-workflow-id' }),
    },
  }
}

const mockActor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'user-1@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users', _strategy: 'better-auth' },
}

describe('createServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when not authenticated', async () => {
    vi.mocked(getActor).mockResolvedValue(null)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when virtual cluster not found', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue(null),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result).toEqual({ success: false, error: 'Virtual cluster not found' })
  })

  it('should return error when virtual cluster is not active', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'provisioning',
        application: 'app-1',
      }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result).toEqual({
      success: false,
      error: 'Virtual cluster is still provisioning. Please wait for it to become active.',
    })
  })

  it('should return error when virtual cluster is read_only', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'read_only',
        application: 'app-1',
      }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result).toEqual({
      success: false,
      error: 'Virtual cluster is in read-only mode. Cannot create new service accounts.',
    })
  })

  it('should return error when user is not workspace admin', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'active',
        environment: 'dev',
        application: {
          id: 'app-1',
          slug: 'test-app',
          workspace: { id: 'ws-1', slug: 'test-workspace' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }), // No membership found
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'test', actor: mockActor } as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' })
  })

  it('should return error when username already exists', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'active',
        environment: 'dev',
        application: {
          id: 'app-1',
          slug: 'test-app',
          workspace: { id: 'ws-1', slug: 'test-workspace' },
        },
      }),
      find: vi.fn().mockResolvedValueOnce({ docs: [{ id: 'existing-sa' }] }), // username exists
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor } as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result).toEqual({
      success: false,
      error: 'A service account with this name already exists',
    })
  })

  it('should create service account successfully', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'active',
        environment: 'dev',
        application: {
          id: 'app-1',
          slug: 'test-app',
          workspace: { id: 'ws-1', slug: 'test-workspace' },
        },
      }),
      find: vi.fn().mockResolvedValueOnce({ docs: [] }), // no existing username
      create: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor } as never)

    const mockTemporalClient = createMockTemporalClient()
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result.success).toBe(true)
    expect(result.serviceAccountId).toBe('sa-1')
    expect(result.username).toBe('test-workspace.test-app.dev.test-sa')
    expect(result.password).toBe('generated-password-123')
    expect(mockPayload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'kafka-service-accounts',
        data: expect.objectContaining({
          name: 'test-sa',
          status: 'active',
          permissionTemplate: 'producer',
          createdBy: 'pl-1',
        }),
      })
    )
  })

  it('should rollback service account when workflow fails to start', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'active',
        environment: 'dev',
        application: {
          id: 'app-1',
          slug: 'test-app',
          workspace: { id: 'ws-1', slug: 'test-workspace' },
        },
      }),
      find: vi.fn().mockResolvedValueOnce({ docs: [] }), // no existing username
      create: vi.fn().mockResolvedValue({ id: 'sa-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor } as never)

    // Mock workflow failure
    const mockTemporalClient = {
      workflow: {
        start: vi.fn().mockRejectedValue(new Error('Temporal connection failed')),
      },
    }
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Failed to sync credential to Bifrost. Service account was not created.'
    )
    // Verify rollback was called
    expect(mockPayload.delete).toHaveBeenCalledWith({
      collection: 'kafka-service-accounts',
      id: 'sa-1',
      overrideAccess: true,
    })
  })

  it('should return critical error when rollback fails', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'active',
        environment: 'dev',
        application: {
          id: 'app-1',
          slug: 'test-app',
          workspace: { id: 'ws-1', slug: 'test-workspace' },
        },
      }),
      find: vi.fn().mockResolvedValueOnce({ docs: [] }), // no existing username
      create: vi.fn().mockResolvedValue({ id: 'sa-1' }),
      delete: vi.fn().mockRejectedValue(new Error('Database error')), // Rollback fails
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor } as never)

    // Mock workflow failure
    const mockTemporalClient = {
      workflow: {
        start: vi.fn().mockRejectedValue(new Error('Temporal connection failed')),
      },
    }
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Failed to sync credential to Bifrost and cleanup failed. Please contact support.'
    )
  })

  it('should handle workflow already started gracefully', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'vc-1',
        status: 'active',
        environment: 'dev',
        application: {
          id: 'app-1',
          slug: 'test-app',
          workspace: { id: 'ws-1', slug: 'test-workspace' },
        },
      }),
      find: vi.fn().mockResolvedValueOnce({ docs: [] }), // no existing username
      create: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor } as never)

    // Mock workflow already started error
    const mockTemporalClient = {
      workflow: {
        start: vi.fn().mockRejectedValue(
          new WorkflowExecutionAlreadyStartedError(
            'Workflow already started',
            'credential-upsert-sa-1',
            'CredentialUpsertWorkflow'
          )
        ),
      },
    }
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await createServiceAccount({
      name: 'test-sa',
      applicationId: 'app-1',
      virtualClusterId: 'vc-1',
      permissionTemplate: 'producer',
    })

    // Should succeed because workflow already running is treated as success
    expect(result.success).toBe(true)
    expect(result.serviceAccountId).toBe('sa-1')
  })
})

describe('rotateServiceAccountPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when not authenticated', async () => {
    vi.mocked(getActor).mockResolvedValue(null)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when service account not found', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue(null),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result).toEqual({ success: false, error: 'Service account not found' })
  })

  it('should return error when user lacks permissions', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        username: 'test-username',
        passwordHash: 'old-hash',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }), // No membership
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'test', actor: mockActor } as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' })
  })

  it('should return error when service account is revoked', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'revoked',
        username: 'test-username',
        passwordHash: 'old-hash',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result).toEqual({ success: false, error: 'Cannot rotate revoked service account' })
  })

  it('should enforce rate limiting (5 minute cooldown)', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    // Last rotated 2 minutes ago
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        username: 'test-username',
        passwordHash: 'old-hash',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        lastRotatedAt: twoMinutesAgo,
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Please wait \d+ seconds before rotating again/)
  })

  it('should allow rotation after cooldown expires', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    // Last rotated 6 minutes ago (past 5 minute cooldown)
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        username: 'test-username',
        passwordHash: 'old-hash',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        lastRotatedAt: sixMinutesAgo,
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    const mockTemporalClient = createMockTemporalClient()
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result.success).toBe(true)
    expect(result.password).toBe('generated-password-123')
  })

  it('should rotate password successfully', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        username: 'test-username',
        passwordHash: 'old-hash',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    const mockTemporalClient = createMockTemporalClient()
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result.success).toBe(true)
    expect(result.password).toBe('generated-password-123')
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'kafka-service-accounts',
        id: 'sa-1',
        data: expect.objectContaining({
          passwordHash: 'hashed-generated-password-123',
        }),
      })
    )
  })

  it('should rollback password when workflow fails to start', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        username: 'test-username',
        passwordHash: 'original-hash',
        lastRotatedAt: '2024-01-01T00:00:00Z',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    // Mock workflow failure
    const mockTemporalClient = {
      workflow: {
        start: vi.fn().mockRejectedValue(new Error('Temporal connection failed')),
      },
    }
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to sync credential to Bifrost. Password was not rotated.')

    // Verify rollback was called with original values
    expect(mockPayload.update).toHaveBeenCalledTimes(2)
    expect(mockPayload.update).toHaveBeenLastCalledWith({
      collection: 'kafka-service-accounts',
      id: 'sa-1',
      data: {
        passwordHash: 'original-hash',
        lastRotatedAt: '2024-01-01T00:00:00Z',
      },
      overrideAccess: true,
    })
  })

  it('should return critical error when rollback fails', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        username: 'test-username',
        passwordHash: 'original-hash',
        lastRotatedAt: '2024-01-01T00:00:00Z',
        permissionTemplate: 'producer',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi
        .fn()
        .mockResolvedValueOnce({ id: 'sa-1' }) // First update succeeds
        .mockRejectedValueOnce(new Error('Database error')), // Rollback fails
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    // Mock workflow failure
    const mockTemporalClient = {
      workflow: {
        start: vi.fn().mockRejectedValue(new Error('Temporal connection failed')),
      },
    }
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await rotateServiceAccountPassword('sa-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Password rotation failed and rollback failed. Please contact support immediately.'
    )
  })
})

describe('revokeServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when not authenticated', async () => {
    vi.mocked(getActor).mockResolvedValue(null)

    const result = await revokeServiceAccount('sa-1')

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return error when service account not found', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue(null),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await revokeServiceAccount('sa-1')

    expect(result).toEqual({ success: false, error: 'Service account not found' })
  })

  it('should return error when user lacks permissions', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }), // No membership
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: false, reason: 'test', actor: mockActor } as never)

    const result = await revokeServiceAccount('sa-1')

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' })
  })

  it('should return error when service account is already revoked', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'revoked',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    const result = await revokeServiceAccount('sa-1')

    expect(result).toEqual({ success: false, error: 'Service account is already revoked' })
  })

  it('should revoke service account successfully', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    const mockTemporalClient = createMockTemporalClient()
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const result = await revokeServiceAccount('sa-1')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'kafka-service-accounts',
        id: 'sa-1',
        data: expect.objectContaining({
          status: 'revoked',
          revokedBy: 'pl-1',
        }),
      })
    )
    expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
      'CredentialRevokeWorkflow',
      expect.objectContaining({
        taskQueue: 'orbit-workflows',
        args: [{ credentialId: 'sa-1' }],
      })
    )
  })

  it('should still succeed when workflow fails (revocation is logged)', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'sa-1',
        status: 'active',
        virtualCluster: 'vc-1',
        application: {
          id: 'app-1',
          workspace: { id: 'ws-1' },
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'admin' }] }),
      update: vi.fn().mockResolvedValue({ id: 'sa-1' }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)
    vi.mocked(check).mockResolvedValue({ allowed: true, reason: 'test', actor: mockActor } as never)

    // Mock workflow failure - revoke should still succeed in DB
    const mockTemporalClient = {
      workflow: {
        start: vi.fn().mockRejectedValue(new Error('Temporal connection failed')),
      },
    }
    vi.mocked(getTemporalClient).mockResolvedValue(mockTemporalClient as never)

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await revokeServiceAccount('sa-1')

    // Revocation succeeds in DB even if Bifrost sync fails
    expect(result).toEqual({ success: true })
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})

describe('listServiceAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return error when not authenticated', async () => {
    vi.mocked(getActor).mockResolvedValue(null)

    const result = await listServiceAccounts({ virtualClusterId: 'vc-1' })

    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should return service accounts for virtual cluster', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockServiceAccounts = [
      {
        id: 'sa-1',
        name: 'producer-sa',
        username: 'ws.app.dev.producer-sa',
        permissionTemplate: 'producer',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        lastRotatedAt: '2024-01-15T00:00:00Z',
      },
      {
        id: 'sa-2',
        name: 'consumer-sa',
        username: 'ws.app.dev.consumer-sa',
        permissionTemplate: 'consumer',
        status: 'revoked',
        createdAt: '2024-01-02T00:00:00Z',
      },
    ]

    const mockPayload = createMockPayload({
      find: vi.fn().mockResolvedValue({ docs: mockServiceAccounts }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await listServiceAccounts({ virtualClusterId: 'vc-1' })

    expect(result.success).toBe(true)
    expect(result.serviceAccounts).toHaveLength(2)
    expect(result.serviceAccounts?.[0]).toEqual({
      id: 'sa-1',
      name: 'producer-sa',
      username: 'ws.app.dev.producer-sa',
      permissionTemplate: 'producer',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      lastRotatedAt: '2024-01-15T00:00:00Z',
    })
    expect(result.serviceAccounts?.[1].lastRotatedAt).toBeUndefined()

    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'kafka-service-accounts',
      where: {
        virtualCluster: { equals: 'vc-1' },
      },
      sort: '-createdAt',
      limit: 100,
    })
  })

  it('should return empty array when no service accounts exist', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      find: vi.fn().mockResolvedValue({ docs: [] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await listServiceAccounts({ virtualClusterId: 'vc-1' })

    expect(result.success).toBe(true)
    expect(result.serviceAccounts).toEqual([])
  })

  it('should handle database errors gracefully', async () => {
    vi.mocked(getActor).mockResolvedValue(mockActor as never)

    const mockPayload = createMockPayload({
      find: vi.fn().mockRejectedValue(new Error('Database connection failed')),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await listServiceAccounts({ virtualClusterId: 'vc-1' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to list service accounts')
  })
})
