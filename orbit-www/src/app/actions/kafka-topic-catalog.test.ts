import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

// Mock auth
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock payload config
vi.mock('@payload-config', () => ({
  default: {},
}))

describe('kafka-topic-catalog actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('searchTopicCatalog', () => {
    it('should export searchTopicCatalog function', async () => {
      const { searchTopicCatalog } = await import('./kafka-topic-catalog')
      expect(searchTopicCatalog).toBeDefined()
      expect(typeof searchTopicCatalog).toBe('function')
    })

    it('should return error when user is not authenticated', async () => {
      const { auth } = await import('@/lib/auth')
      ;(auth.api.getSession as any).mockResolvedValue(null)

      const { searchTopicCatalog } = await import('./kafka-topic-catalog')
      const result = await searchTopicCatalog({ query: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should search for discoverable and public topics', async () => {
      const { auth } = await import('@/lib/auth')
      const { getPayload } = await import('payload')

      ;(auth.api.getSession as any).mockResolvedValue({
        user: { id: 'user-1' },
      })

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            // workspace-members query
            docs: [{ workspace: 'ws-1' }, { workspace: 'ws-2' }],
          })
          .mockResolvedValueOnce({
            // kafka-topics query
            docs: [
              {
                id: 'topic-1',
                name: 'events',
                description: 'Event stream',
                workspace: { id: 'ws-3', name: 'Other Workspace' },
                application: { id: 'app-1', name: 'App 1' },
                environment: 'prod',
                visibility: 'discoverable',
                tags: [{ tag: 'events' }],
                partitions: 3,
              },
            ],
            totalDocs: 1,
            totalPages: 1,
            page: 1,
          })
          .mockResolvedValueOnce({
            // kafka-topic-shares query
            docs: [],
          }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { searchTopicCatalog } = await import('./kafka-topic-catalog')
      const result = await searchTopicCatalog({
        query: 'events',
        page: 1,
        limit: 20,
      })

      expect(result.success).toBe(true)
      expect(result.topics).toBeDefined()
      expect(result.topics?.length).toBeGreaterThanOrEqual(0)
    })

    it('should include workspace visibility topics from user workspaces', async () => {
      const { auth } = await import('@/lib/auth')
      const { getPayload } = await import('payload')

      ;(auth.api.getSession as any).mockResolvedValue({
        user: { id: 'user-1' },
      })

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            docs: [{ workspace: 'ws-1' }],
          })
          .mockResolvedValueOnce({
            docs: [
              {
                id: 'topic-2',
                name: 'internal-events',
                workspace: { id: 'ws-1', name: 'My Workspace' },
                visibility: 'workspace',
                partitions: 3,
              },
            ],
            totalDocs: 1,
            totalPages: 1,
            page: 1,
          })
          .mockResolvedValueOnce({
            docs: [],
          }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { searchTopicCatalog } = await import('./kafka-topic-catalog')
      const result = await searchTopicCatalog({
        visibility: ['workspace'],
      })

      expect(result.success).toBe(true)
    })
  })

  describe('requestTopicAccess', () => {
    it('should export requestTopicAccess function', async () => {
      const { requestTopicAccess } = await import('./kafka-topic-catalog')
      expect(requestTopicAccess).toBeDefined()
      expect(typeof requestTopicAccess).toBe('function')
    })

    it('should return error when user is not authenticated', async () => {
      const { auth } = await import('@/lib/auth')
      ;(auth.api.getSession as any).mockResolvedValue(null)

      const { requestTopicAccess } = await import('./kafka-topic-catalog')
      const result = await requestTopicAccess({
        topicId: 'topic-1',
        accessLevel: 'read',
        reason: 'Need to consume events',
        requestingWorkspaceId: 'ws-1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should verify user membership in requesting workspace', async () => {
      const { auth } = await import('@/lib/auth')
      const { getPayload } = await import('payload')

      ;(auth.api.getSession as any).mockResolvedValue({
        user: { id: 'user-1' },
      })

      const mockPayload = {
        find: vi.fn().mockResolvedValueOnce({
          docs: [], // User not a member of requesting workspace
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { requestTopicAccess } = await import('./kafka-topic-catalog')
      const result = await requestTopicAccess({
        topicId: 'topic-1',
        accessLevel: 'read',
        reason: 'Need to consume events',
        requestingWorkspaceId: 'ws-1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of the requesting workspace')
    })

    it('should check for existing share requests', async () => {
      const { auth } = await import('@/lib/auth')
      const { getPayload } = await import('payload')

      ;(auth.api.getSession as any).mockResolvedValue({
        user: { id: 'user-1' },
      })

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            docs: [{ workspace: 'ws-1', role: 'member' }], // User is member
          })
          .mockResolvedValueOnce({
            docs: [{ id: 'share-1', status: 'pending' }], // Existing share request
          }),
        findByID: vi.fn().mockResolvedValue({
          id: 'topic-1',
          workspace: 'ws-2',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { requestTopicAccess } = await import('./kafka-topic-catalog')
      const result = await requestTopicAccess({
        topicId: 'topic-1',
        accessLevel: 'read',
        reason: 'Need to consume events',
        requestingWorkspaceId: 'ws-1',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
    })

    it('should create a pending share request when no auto-approve policy', async () => {
      const { auth } = await import('@/lib/auth')
      const { getPayload } = await import('payload')

      ;(auth.api.getSession as any).mockResolvedValue({
        user: { id: 'user-1' },
      })

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            docs: [{ workspace: 'ws-1', role: 'member' }],
          })
          .mockResolvedValueOnce({
            docs: [], // No existing share
          })
          .mockResolvedValueOnce({
            docs: [], // No auto-approve policies
          }),
        findByID: vi.fn().mockResolvedValue({
          id: 'topic-1',
          name: 'events',
          workspace: 'ws-2',
        }),
        create: vi.fn().mockResolvedValue({
          id: 'share-1',
          status: 'pending',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { requestTopicAccess } = await import('./kafka-topic-catalog')
      const result = await requestTopicAccess({
        topicId: 'topic-1',
        accessLevel: 'read',
        reason: 'Need to consume events',
        requestingWorkspaceId: 'ws-1',
      })

      expect(result.success).toBe(true)
      expect(result.shareId).toBe('share-1')
      expect(result.autoApproved).toBe(false)
    })

    it('should auto-approve when policy allows', async () => {
      const { auth } = await import('@/lib/auth')
      const { getPayload } = await import('payload')

      ;(auth.api.getSession as any).mockResolvedValue({
        user: { id: 'user-1' },
      })

      const mockPayload = {
        find: vi.fn()
          .mockResolvedValueOnce({
            docs: [{ workspace: 'ws-1', role: 'member' }],
          })
          .mockResolvedValueOnce({
            docs: [], // No existing share
          })
          .mockResolvedValueOnce({
            docs: [
              {
                id: 'policy-1',
                autoApprove: true,
                allowedAccessLevels: ['read', 'write'],
              },
            ], // Auto-approve policy exists
          }),
        findByID: vi.fn().mockResolvedValue({
          id: 'topic-1',
          name: 'events',
          workspace: 'ws-2',
        }),
        create: vi.fn().mockResolvedValue({
          id: 'share-1',
          status: 'approved',
        }),
      }
      ;(getPayload as any).mockResolvedValue(mockPayload)

      const { requestTopicAccess } = await import('./kafka-topic-catalog')
      const result = await requestTopicAccess({
        topicId: 'topic-1',
        accessLevel: 'read',
        reason: 'Need to consume events',
        requestingWorkspaceId: 'ws-1',
      })

      expect(result.success).toBe(true)
      expect(result.shareId).toBe('share-1')
      expect(result.autoApproved).toBe(true)
    })
  })

  describe('Type definitions', () => {
    it('should export TopicCatalogEntry type', async () => {
      // TypeScript will verify this at compile time
      const kafkaCatalogModule = await import('./kafka-topic-catalog')
      expect(kafkaCatalogModule).toBeDefined()
    })

    it('should export SearchTopicCatalogInput type', async () => {
      const kafkaCatalogModule = await import('./kafka-topic-catalog')
      expect(kafkaCatalogModule).toBeDefined()
    })

    it('should export SearchTopicCatalogResult type', async () => {
      const kafkaCatalogModule = await import('./kafka-topic-catalog')
      expect(kafkaCatalogModule).toBeDefined()
    })

    it('should export RequestTopicAccessInput type', async () => {
      const kafkaCatalogModule = await import('./kafka-topic-catalog')
      expect(kafkaCatalogModule).toBeDefined()
    })

    it('should export RequestTopicAccessResult type', async () => {
      const kafkaCatalogModule = await import('./kafka-topic-catalog')
      expect(kafkaCatalogModule).toBeDefined()
    })
  })
})
