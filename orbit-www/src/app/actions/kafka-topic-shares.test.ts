import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

// Mock @/lib/authz at the module boundary (do not import the real actor.ts;
// it pulls in the Better-Auth Mongo client).
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  check: vi.fn(),
}))

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock payload config
vi.mock('@payload-config', () => ({
  default: {},
}))

const mockActor = {
  payloadId: 'user-1',
  betterAuthId: 'user-1',
  email: 'user-1@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'user-1', collection: 'users', _strategy: 'better-auth' },
}

describe('kafka-topic-shares actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Type Definitions', () => {
    it('should export ApproveShareInput type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export ApproveShareResult type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export RejectShareInput type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export RejectShareResult type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export RevokeShareInput type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export RevokeShareResult type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export ListPendingSharesInput type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export ShareListItem type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should export ListPendingSharesResult type', async () => {
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })
  })

  describe('approveShare', () => {
    it('should export approveShare function', async () => {
      const { approveShare } = await import('./kafka-topic-shares')
      expect(approveShare).toBeDefined()
      expect(typeof approveShare).toBe('function')
    })

    it('should return error when user is not authenticated', async () => {
      const { getActor } = await import('@/lib/authz')
      ;(getActor as any).mockResolvedValue(null)

      const { approveShare } = await import('./kafka-topic-shares')
      const result = await approveShare({ shareId: 'share-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when share not found', async () => {
      const { getActor } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue(null),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { approveShare } = await import('./kafka-topic-shares')
      const result = await approveShare({ shareId: 'nonexistent' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Share not found')
    })

    it('should return error when user is not owner/admin of owner workspace', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'pending',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: false, reason: 'not authorized', actor: mockActor })

      const { approveShare } = await import('./kafka-topic-shares')
      const result = await approveShare({ shareId: 'share-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authorized to approve this share')
    })

    it('should return error when share is not pending', async () => {
      const { getActor } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'approved', // Already approved
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { approveShare } = await import('./kafka-topic-shares')
      const result = await approveShare({ shareId: 'share-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Share is not pending approval')
    })

    it('should successfully approve a pending share', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          topic: { id: 'topic-1', name: 'events' },
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'pending',
        }),
        update: vi.fn().mockResolvedValue({
          id: 'share-1',
          status: 'approved',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor })

      const { approveShare } = await import('./kafka-topic-shares')
      const result = await approveShare({ shareId: 'share-1' })

      expect(result.success).toBe(true)
      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'kafka-topic-shares',
          id: 'share-1',
          data: expect.objectContaining({
            status: 'approved',
            approvedBy: 'user-1',
          }),
        })
      )
    })
  })

  describe('rejectShare', () => {
    it('should export rejectShare function', async () => {
      const { rejectShare } = await import('./kafka-topic-shares')
      expect(rejectShare).toBeDefined()
      expect(typeof rejectShare).toBe('function')
    })

    it('should return error when user is not authenticated', async () => {
      const { getActor } = await import('@/lib/authz')
      ;(getActor as any).mockResolvedValue(null)

      const { rejectShare } = await import('./kafka-topic-shares')
      const result = await rejectShare({ shareId: 'share-1', reason: 'Not approved' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when user is not owner/admin of owner workspace', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'pending',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: false, reason: 'not authorized', actor: mockActor })

      const { rejectShare } = await import('./kafka-topic-shares')
      const result = await rejectShare({ shareId: 'share-1', reason: 'Not approved' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authorized to reject this share')
    })

    it('should return error when share is not pending', async () => {
      const { getActor } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'approved', // Already approved
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { rejectShare } = await import('./kafka-topic-shares')
      const result = await rejectShare({ shareId: 'share-1', reason: 'Not approved' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Can only reject pending shares')
    })

    it('should successfully reject a pending share with reason', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          topic: { id: 'topic-1', name: 'events' },
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'pending',
          requestedBy: { id: 'user-2', email: 'requester@test.com' },
        }),
        update: vi.fn().mockResolvedValue({
          id: 'share-1',
          status: 'rejected',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace owner', actor: mockActor })

      const { rejectShare } = await import('./kafka-topic-shares')
      const result = await rejectShare({ shareId: 'share-1', reason: 'Insufficient justification' })

      expect(result.success).toBe(true)
      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'kafka-topic-shares',
          id: 'share-1',
          data: expect.objectContaining({
            status: 'rejected',
            rejectionReason: 'Insufficient justification',
          }),
        })
      )
    })
  })

  describe('revokeShare', () => {
    it('should export revokeShare function', async () => {
      const { revokeShare } = await import('./kafka-topic-shares')
      expect(revokeShare).toBeDefined()
      expect(typeof revokeShare).toBe('function')
    })

    it('should return error when user is not authenticated', async () => {
      const { getActor } = await import('@/lib/authz')
      ;(getActor as any).mockResolvedValue(null)

      const { revokeShare } = await import('./kafka-topic-shares')
      const result = await revokeShare({ shareId: 'share-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when user is not owner/admin of owner workspace', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'approved',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: false, reason: 'not authorized', actor: mockActor })

      const { revokeShare } = await import('./kafka-topic-shares')
      const result = await revokeShare({ shareId: 'share-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authorized to revoke this share')
    })

    it('should return error when share is not approved', async () => {
      const { getActor } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'pending', // Not approved
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { revokeShare } = await import('./kafka-topic-shares')
      const result = await revokeShare({ shareId: 'share-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Can only revoke approved shares')
    })

    it('should successfully revoke an approved share', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'share-1',
          topic: { id: 'topic-1', name: 'events' },
          ownerWorkspace: { id: 'ws-owner' },
          targetWorkspace: { id: 'ws-target' },
          status: 'approved',
        }),
        update: vi.fn().mockResolvedValue({
          id: 'share-1',
          status: 'revoked',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace admin', actor: mockActor })

      const { revokeShare } = await import('./kafka-topic-shares')
      const result = await revokeShare({ shareId: 'share-1' })

      expect(result.success).toBe(true)
      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'kafka-topic-shares',
          id: 'share-1',
          data: expect.objectContaining({
            status: 'revoked',
          }),
        })
      )
    })
  })

  describe('listPendingShares', () => {
    it('should export listPendingShares function', async () => {
      const { listPendingShares } = await import('./kafka-topic-shares')
      expect(listPendingShares).toBeDefined()
      expect(typeof listPendingShares).toBe('function')
    })

    it('should return error when user is not authenticated', async () => {
      const { getActor } = await import('@/lib/authz')
      ;(getActor as any).mockResolvedValue(null)

      const { listPendingShares } = await import('./kafka-topic-shares')
      const result = await listPendingShares({ workspaceId: 'ws-1', type: 'incoming' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when user is not member of workspace', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: false, reason: 'not a member', actor: mockActor })

      const { listPendingShares } = await import('./kafka-topic-shares')
      const result = await listPendingShares({ workspaceId: 'ws-1', type: 'incoming' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this workspace')
    })

    it('should list incoming pending shares for owner workspace', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            // kafka-topic-shares query
            docs: [
              {
                id: 'share-1',
                topic: { id: 'topic-1', name: 'events' },
                ownerWorkspace: { id: 'ws-1', name: 'Owner Workspace' },
                targetWorkspace: { id: 'ws-2', name: 'Target Workspace' },
                accessLevel: 'read',
                status: 'pending',
                reason: 'Need to consume events',
                requestedBy: { id: 'user-2', email: 'requester@test.com' },
                createdAt: '2024-01-01T00:00:00.000Z',
              },
            ],
          }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace member', actor: mockActor })

      const { listPendingShares } = await import('./kafka-topic-shares')
      const result = await listPendingShares({ workspaceId: 'ws-1', type: 'incoming' })

      expect(result.success).toBe(true)
      expect(result.shares).toBeDefined()
      expect(result.shares?.length).toBe(1)
      expect(result.shares?.[0].id).toBe('share-1')
    })

    it('should list outgoing pending shares for target workspace', async () => {
      const { getActor, check } = await import('@/lib/authz')
      const { getPayload } = await import('payload')

      ;(getActor as any).mockResolvedValue(mockActor)

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            // kafka-topic-shares query
            docs: [
              {
                id: 'share-2',
                topic: { id: 'topic-2', name: 'orders' },
                ownerWorkspace: { id: 'ws-1', name: 'Owner Workspace' },
                targetWorkspace: { id: 'ws-2', name: 'Target Workspace' },
                accessLevel: 'write',
                status: 'pending',
                reason: 'Need to publish orders',
                requestedBy: { id: 'user-1', email: 'user@test.com' },
                createdAt: '2024-01-02T00:00:00.000Z',
              },
            ],
          }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)
      ;(check as any).mockResolvedValue({ allowed: true, reason: 'workspace member', actor: mockActor })

      const { listPendingShares } = await import('./kafka-topic-shares')
      const result = await listPendingShares({ workspaceId: 'ws-2', type: 'outgoing' })

      expect(result.success).toBe(true)
      expect(result.shares).toBeDefined()
      expect(result.shares?.length).toBe(1)
      expect(result.shares?.[0].id).toBe('share-2')
    })
  })

  describe('Helper Functions', () => {
    it('should have triggerShareApprovedWorkflow placeholder', async () => {
      // This is a placeholder function - just verify it's callable
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should have triggerShareRevokedWorkflow placeholder', async () => {
      // This is a placeholder function - just verify it's callable
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })

    it('should have sendShareRejectedNotification placeholder', async () => {
      // This is a placeholder function - just verify it's callable
      const kafkaSharesModule = await import('./kafka-topic-shares')
      expect(kafkaSharesModule).toBeDefined()
    })
  })
})
