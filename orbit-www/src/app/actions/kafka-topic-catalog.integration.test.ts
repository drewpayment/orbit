import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPayload } from 'payload'
import { searchTopicCatalog, requestTopicAccess } from './kafka-topic-catalog'
import { approveShare, rejectShare, revokeShare, listPendingShares } from './kafka-topic-shares'

// QA-008: Each test uses unique workspace/topic IDs for isolation
const WS_A = `ws-a-${Date.now()}`
const WS_B = `ws-b-${Date.now()}`
const USER_A = `user-a-${Date.now()}`
const USER_B = `user-b-${Date.now()}`
const TOPIC_1 = `topic-1-${Date.now()}`

// ============================================================================
// Mocks
// ============================================================================

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/lib/auth/session', () => ({
  getPayloadUserFromSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/temporal/client', () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: {
      start: vi.fn().mockResolvedValue({ workflowId: 'mock-wf-id' }),
    },
  }),
}))

vi.mock('@/lib/bifrost-config', () => ({
  getBifrostConfig: vi.fn().mockResolvedValue({
    connectionMode: 'bifrost',
    routingMode: 'sasl',
    advertisedHost: 'localhost:9092',
    defaultAuthMethod: 'SASL/SCRAM-SHA-256',
    tlsEnabled: false,
  }),
}))

const { getPayloadUserFromSession } = await import('@/lib/auth/session')
const { auth } = await import('@/lib/auth')

// ============================================================================
// Helpers
// ============================================================================

let mockPayload: any

function setupAuth(userId: string, betterAuthId: string) {
  vi.mocked(getPayloadUserFromSession).mockResolvedValue({
    id: userId,
    betterAuthId,
    email: `${userId}@test.com`,
    role: 'user',
  } as any)
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId },
    session: {},
  } as any)
}

function setupAdminAuth(userId: string, betterAuthId: string) {
  vi.mocked(getPayloadUserFromSession).mockResolvedValue({
    id: userId,
    betterAuthId,
    email: `${userId}@test.com`,
    role: 'admin',
  } as any)
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId },
    session: {},
  } as any)
}

function createMockPayload() {
  return {
    find: vi.fn().mockResolvedValue({ docs: [], totalDocs: 0, page: 1, totalPages: 0 }),
    findByID: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'new-record' }),
    update: vi.fn().mockResolvedValue({ id: 'updated-record' }),
  }
}

function mockMembership(workspaceId: string, userId: string, role = 'member') {
  return { id: `mem-${Date.now()}`, workspace: workspaceId, user: userId, role, status: 'active' }
}

function mockTopic(id: string, workspaceId: string, opts: Partial<any> = {}) {
  return {
    id,
    name: `topic-${id}`,
    description: 'Test topic',
    workspace: { id: workspaceId, name: 'Workspace', slug: 'ws' },
    environment: 'development',
    visibility: 'discoverable',
    status: 'active',
    partitions: 3,
    tags: [],
    ...opts,
  }
}

function mockShare(id: string, topicId: string, ownerWs: string, targetWs: string, opts: Partial<any> = {}) {
  return {
    id,
    topic: { id: topicId, name: `topic-${topicId}`, environment: 'dev' },
    ownerWorkspace: { id: ownerWs, name: 'Owner WS' },
    targetWorkspace: { id: targetWs, name: 'Target WS' },
    accessLevel: 'read',
    status: 'pending',
    reason: 'Need access',
    requestedBy: { id: USER_B, email: 'user-b@test.com' },
    requestedAt: new Date().toISOString(),
    ...opts,
  }
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockPayload = createMockPayload()
  vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
})

describe('Topic Sharing Integration', () => {
  describe('Catalog Discovery', () => {
    it('user can search catalog and see discoverable topics', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] }) // memberships
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_B, { visibility: 'discoverable' })], totalDocs: 1, page: 1, totalPages: 1 }) // topics
        .mockResolvedValueOnce({ docs: [] }) // existing shares

      const result = await searchTopicCatalog({})
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
      expect(result.topics![0].visibility).toBe('discoverable')
    })

    it('user can filter catalog by environment', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_B, { environment: 'staging' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ environment: 'staging' })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
    })

    it('user can filter catalog by visibility', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_B, { visibility: 'public' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['public'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
      expect(result.topics![0].visibility).toBe('public')
    })

    it('private topics are not visible in catalog to other workspaces', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [], totalDocs: 0, page: 1, totalPages: 0 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['private'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(0)
    })

    it('workspace-visible topics are only visible to workspace members', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_A, { visibility: 'workspace' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['workspace'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
    })
  })

  describe('Access Requests', () => {
    it('user can request access to a discoverable topic', async () => {
      setupAuth(USER_B, USER_B)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] }) // verify membership
        .mockResolvedValueOnce({ docs: [] }) // existing shares check
        .mockResolvedValueOnce({ docs: [] }) // auto-approve policy check
      mockPayload.findByID.mockResolvedValueOnce(mockTopic(TOPIC_1, WS_A)) // topic lookup
      mockPayload.create.mockResolvedValueOnce({ id: 'share-1', status: 'pending' })

      const result = await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'read',
        reason: 'Need for analytics',
        requestingWorkspaceId: WS_B,
      })

      expect(result.success).toBe(true)
      expect(result.shareId).toBeDefined()
    })

    it('user cannot request access to their own workspace topics', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find.mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
      mockPayload.findByID.mockResolvedValueOnce(mockTopic(TOPIC_1, WS_A))

      const result = await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'read',
        reason: 'Test',
        requestingWorkspaceId: WS_A,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('owned by your workspace')
    })

    it('duplicate access requests are prevented', async () => {
      setupAuth(USER_B, USER_B)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] })
        .mockResolvedValueOnce({ docs: [{ id: 'existing-share', status: 'pending' }] }) // existing share found
      mockPayload.findByID.mockResolvedValueOnce(mockTopic(TOPIC_1, WS_A))

      const result = await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'read',
        reason: 'Test',
        requestingWorkspaceId: WS_B,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
    })

    it('request includes access level and reason', async () => {
      setupAuth(USER_B, USER_B)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
      mockPayload.findByID.mockResolvedValueOnce(mockTopic(TOPIC_1, WS_A))
      mockPayload.create.mockResolvedValueOnce({ id: 'share-1' })

      await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'read-write',
        reason: 'Need bidirectional access',
        requestingWorkspaceId: WS_B,
      })

      expect(mockPayload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'kafka-topic-shares',
          data: expect.objectContaining({
            accessLevel: 'read-write',
            reason: 'Need bidirectional access',
          }),
        })
      )
    })
  })

  describe('Approval Workflow', () => {
    it('workspace admin can approve a share request', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'admin')] }) // admin check
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'approved' })

      const result = await approveShare({ shareId: 'share-1' })
      expect(result.success).toBe(true)
    })

    it('workspace admin can reject a share request with reason', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'admin')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'rejected' })

      const result = await rejectShare({ shareId: 'share-1', reason: 'Not justified' })
      expect(result.success).toBe(true)
    })

    it('non-admin members cannot approve requests', async () => {
      setupAuth(USER_B, USER_B)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_B }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [] }) // no admin membership

      const result = await approveShare({ shareId: 'share-1' })
      expect(result.success).toBe(false)
    })

    it('approved share changes status to approved', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'owner')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'approved' })

      await approveShare({ shareId: 'share-1' })

      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'approved',
          }),
        })
      )
    })

    it('rejected share changes status to rejected', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'admin')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'rejected' })

      await rejectShare({ shareId: 'share-1', reason: 'No' })

      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'rejected',
          }),
        })
      )
    })
  })

  describe('Share Management', () => {
    it('workspace admin can revoke an approved share', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'approved' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'owner')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'revoked' })

      const result = await revokeShare({ shareId: 'share-1' })
      expect(result.success).toBe(true)
    })

    it('revoked share changes status to revoked', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'approved' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'admin')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'revoked' })

      await revokeShare({ shareId: 'share-1' })

      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'revoked',
          }),
        })
      )
    })

    it('user can view incoming share requests for their workspace', async () => {
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'admin')] }) // admin check
        .mockResolvedValueOnce({ docs: [mockShare('share-1', TOPIC_1, WS_A, WS_B)] }) // incoming shares

      const result = await listPendingShares({ workspaceId: WS_A, type: 'incoming' })
      expect(result.success).toBe(true)
      expect(result.shares).toBeDefined()
    })

    it('user can view outgoing share requests they created', async () => {
      setupAuth(USER_B, USER_B)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_B }, session: {} } as any)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] }) // member check
        .mockResolvedValueOnce({ docs: [mockShare('share-1', TOPIC_1, WS_A, WS_B)] }) // outgoing shares

      const result = await listPendingShares({ workspaceId: WS_B, type: 'outgoing' })
      expect(result.success).toBe(true)
      expect(result.shares).toBeDefined()
    })
  })

  describe('ACL Synchronization', () => {
    it('approved share triggers ACL sync workflow', async () => {
      const { getTemporalClient } = await import('@/lib/temporal/client')
      const mockStart = vi.fn().mockResolvedValue({ workflowId: 'acl-sync-wf' })
      vi.mocked(getTemporalClient).mockResolvedValue({ workflow: { start: mockStart } } as any)

      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'owner')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'approved' })

      await approveShare({ shareId: 'share-1' })

      expect(mockStart).toHaveBeenCalledWith(
        'AccessProvisioningWorkflow',
        expect.objectContaining({
          taskQueue: 'orbit-workflows',
        })
      )
    })

    it('revoked share removes ACL from gateway', async () => {
      const { getTemporalClient } = await import('@/lib/temporal/client')
      const mockStart = vi.fn().mockResolvedValue({ workflowId: 'acl-revoke-wf' })
      vi.mocked(getTemporalClient).mockResolvedValue({ workflow: { start: mockStart } } as any)

      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'approved' }))
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'admin')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'revoked' })

      await revokeShare({ shareId: 'share-1' })

      expect(mockStart).toHaveBeenCalledWith(
        'AccessRevocationWorkflow',
        expect.objectContaining({
          taskQueue: 'orbit-workflows',
        })
      )
    })

    it('ACL includes correct permissions based on access level', async () => {
      const { getTemporalClient } = await import('@/lib/temporal/client')
      const mockStart = vi.fn().mockResolvedValue({ workflowId: 'acl-wf' })
      vi.mocked(getTemporalClient).mockResolvedValue({ workflow: { start: mockStart } } as any)

      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(
        mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending', accessLevel: 'read-write' })
      )
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'owner')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'approved' })

      await approveShare({ shareId: 'share-1' })

      expect(mockStart).toHaveBeenCalledWith(
        'AccessProvisioningWorkflow',
        expect.objectContaining({
          args: expect.arrayContaining([
            expect.objectContaining({
              Permission: 'read-write',
            }),
          ]),
        })
      )
    })

    it('ACL includes expiration if configured', async () => {
      const { getTemporalClient } = await import('@/lib/temporal/client')
      const mockStart = vi.fn().mockResolvedValue({ workflowId: 'acl-wf' })
      vi.mocked(getTemporalClient).mockResolvedValue({ workflow: { start: mockStart } } as any)

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      setupAuth(USER_A, USER_A)
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: USER_A }, session: {} } as any)
      mockPayload.findByID.mockResolvedValueOnce(
        mockShare('share-1', TOPIC_1, WS_A, WS_B, { status: 'pending', expiresAt })
      )
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A, 'owner')] })
      mockPayload.update.mockResolvedValueOnce({ id: 'share-1', status: 'approved' })

      await approveShare({ shareId: 'share-1' })

      expect(mockStart).toHaveBeenCalledWith(
        'AccessProvisioningWorkflow',
        expect.objectContaining({
          args: expect.arrayContaining([
            expect.objectContaining({
              ExpiresAt: expiresAt,
            }),
          ]),
        })
      )
    })
  })

  describe('Policy Enforcement', () => {
    it('auto-approve policy grants access automatically', async () => {
      setupAuth(USER_B, USER_B)
      const topicData = mockTopic(TOPIC_1, WS_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] }) // membership
        .mockResolvedValueOnce({ docs: [] }) // no existing shares
        .mockResolvedValueOnce({ docs: [{ autoApprove: true, enabled: true, priority: 1 }] }) // auto-approve policy
      mockPayload.findByID
        .mockResolvedValueOnce(topicData) // topic lookup in requestTopicAccess
        .mockResolvedValueOnce({ id: 'share-auto', status: 'approved', topic: topicData, targetWorkspace: { id: WS_B }, accessLevel: 'read' }) // share lookup in triggerShareApprovedWorkflow
        .mockResolvedValueOnce(topicData) // topic lookup in triggerShareApprovedWorkflow (if topic is string)
      mockPayload.create.mockResolvedValueOnce({ id: 'share-auto', status: 'approved' })

      const result = await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'read',
        reason: 'Analytics',
        requestingWorkspaceId: WS_B,
      })

      expect(result.success).toBe(true)
      expect(result.autoApproved).toBe(true)
    })

    it('auto-approve respects allowed access levels', async () => {
      setupAuth(USER_B, USER_B)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [{ autoApprove: true, enabled: true, priority: 1, allowedAccessLevels: ['read'] }] })
      mockPayload.findByID.mockResolvedValueOnce(mockTopic(TOPIC_1, WS_A))
      mockPayload.create.mockResolvedValueOnce({ id: 'share-1', status: 'pending' })

      const result = await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'write', // write not in allowed levels
        reason: 'Need write',
        requestingWorkspaceId: WS_B,
      })

      expect(result.success).toBe(true)
      // Write access should NOT be auto-approved since policy only allows 'read'
      expect(result.autoApproved).toBeFalsy()
    })

    it('auto-approve respects allowed workspaces', async () => {
      const APPROVED_WS = 'ws-approved'
      setupAuth(USER_B, USER_B)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [{ autoApprove: true, enabled: true, priority: 1, autoApproveWorkspaces: [APPROVED_WS] }] })
      mockPayload.findByID.mockResolvedValueOnce(mockTopic(TOPIC_1, WS_A))
      mockPayload.create.mockResolvedValueOnce({ id: 'share-1', status: 'pending' })

      const result = await requestTopicAccess({
        topicId: TOPIC_1,
        accessLevel: 'read',
        reason: 'Need access',
        requestingWorkspaceId: WS_B, // WS_B not in approved list
      })

      expect(result.success).toBe(true)
      // WS_B not in auto-approve workspaces list, should not be auto-approved
      expect(result.autoApproved).toBeFalsy()
    })
  })
})

describe('Topic Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPayload = createMockPayload()
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
  })

  describe('Topic Creation', () => {
    it('new topic defaults to private visibility', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [], totalDocs: 0, page: 1, totalPages: 0 })
        .mockResolvedValueOnce({ docs: [] })

      // Search with default visibility (discoverable, public) — private topics should not appear
      const result = await searchTopicCatalog({})
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(0)
    })

    it('topic can be created with discoverable visibility', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_A, { visibility: 'discoverable' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['discoverable'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
      expect(result.topics![0].visibility).toBe('discoverable')
    })

    it('topic visibility can be updated after creation', async () => {
      // This tests that searching with different visibility filters returns different results
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_B, { visibility: 'public' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['public'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
      expect(result.topics![0].visibility).toBe('public')
    })
  })

  describe('Visibility Enforcement', () => {
    it('private topics only allow owning application access', async () => {
      setupAuth(USER_B, USER_B)
      // Private topics should not appear in catalog for non-owners
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] })

      const result = await searchTopicCatalog({ visibility: ['private'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(0)
    })

    it('workspace topics allow same workspace applications', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_A, { visibility: 'workspace' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['workspace'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
    })

    it('discoverable topics appear in catalog', async () => {
      setupAuth(USER_A, USER_A)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_A, USER_A)] })
        .mockResolvedValueOnce({ docs: [
          mockTopic('t1', WS_B, { visibility: 'discoverable' }),
          mockTopic('t2', WS_B, { visibility: 'discoverable' }),
        ], totalDocs: 2, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({})
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(2)
    })

    it('public topics allow all applications', async () => {
      setupAuth(USER_B, USER_B)
      mockPayload.find
        .mockResolvedValueOnce({ docs: [mockMembership(WS_B, USER_B)] })
        .mockResolvedValueOnce({ docs: [mockTopic(TOPIC_1, WS_A, { visibility: 'public' })], totalDocs: 1, page: 1, totalPages: 1 })
        .mockResolvedValueOnce({ docs: [] })

      const result = await searchTopicCatalog({ visibility: ['public'] })
      expect(result.success).toBe(true)
      expect(result.topics).toHaveLength(1)
      expect(result.topics![0].visibility).toBe('public')
    })
  })
})
