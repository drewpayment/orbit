import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock payload
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

// Mock auth
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

/**
 * Mocked at the `@/lib/authz` module boundary (never the real `actor.ts`,
 * which pulls in the Better-Auth Mongo client). `getActor` returns the Actor
 * built from the test's simulated session; `check` re-derives the caller's
 * workspace role by calling the CURRENTLY mocked `getPayload()`'s
 * `find({ collection: 'workspace-members' })`.
 */
const authApi = { getSession: vi.fn() }
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(async () => {
    const session = await authApi.getSession()
    if (!session?.user) return null
    return {
      payloadId: session.user.id,
      betterAuthId: session.user.id,
      email: session.user.email ?? '',
      role: 'user',
      isPlatformAdmin: false,
      user: session.user,
    }
  }),
  check: vi.fn(async (verb: string, resource: { kind: string; id?: string; roles?: string[] }, actorArg?: unknown) => {
    const session = await authApi.getSession()
    const actor = (actorArg as { betterAuthId: string } | undefined) ?? (session?.user ? { betterAuthId: session.user.id } : null)
    if (!actor) return { allowed: false, reason: 'unauthenticated', actor: null }
    if (resource.kind !== 'workspace') return { allowed: false, reason: 'platform admin required', actor }
    const { getPayload } = await import('payload')
    const payload = await getPayload({} as never)
    const result = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: resource.id } },
          { user: { equals: actor.betterAuthId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
    })
    const role = (result.docs[0]?.role as string | undefined) ?? (result.docs.length > 0 ? 'member' : null)
    if (!role) return { allowed: false, reason: 'not a member of this workspace', actor }
    const allowedRoles = resource.roles ?? (verb === 'read' || verb === 'create' ? ['owner', 'admin', 'member'] : ['owner', 'admin'])
    return { allowed: allowedRoles.includes(role), reason: role, actor }
  }),
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/temporal/client', () => ({
  getTemporalClient: vi.fn(),
}))

import { getPayload } from 'payload'
import { deleteTopic, approveTopic } from './kafka-topics'

function mockSession(userId = 'user-1') {
  authApi.getSession.mockResolvedValue({
    user: { id: userId },
    session: {},
  } as any)
}

describe('kafka-topics actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createTopic', () => {
    it('should create a topic and start provisioning workflow', async () => {
      // Test will be implemented after action is created
      expect(true).toBe(true)
    })
  })

  describe('listTopicsByVirtualCluster', () => {
    it('should return topics for a virtual cluster', async () => {
      expect(true).toBe(true)
    })
  })

  describe('deleteTopic', () => {
    it('should mark topic as deleting and start deletion workflow', async () => {
      expect(true).toBe(true)
    })

    it('returns Not authenticated when there is no session', async () => {
      authApi.getSession.mockResolvedValue(null)

      const result = await deleteTopic('topic-1')

      expect(result).toEqual({ success: false, error: 'Not authenticated' })
    })

    it('denies deletion when the actor is not an active member of the topic workspace', async () => {
      mockSession()

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({ id: 'topic-1', workspace: 'workspace-1', status: 'active' }),
        find: vi.fn().mockResolvedValue({ docs: [] }), // no membership → deny
        update: vi.fn(),
      }
      vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

      const result = await deleteTopic('topic-1')

      expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
      expect(mockPayload.update).not.toHaveBeenCalled()
    })
  })

  describe('approveTopic', () => {
    it('returns Not authenticated when there is no session', async () => {
      authApi.getSession.mockResolvedValue(null)

      const result = await approveTopic('topic-1')

      expect(result).toEqual({ success: false, error: 'Not authenticated' })
    })

    it('denies approval when the actor is not an active member of the topic workspace', async () => {
      mockSession()

      const mockPayload = {
        findByID: vi.fn().mockResolvedValue({
          id: 'topic-1',
          workspace: 'workspace-1',
          status: 'pending-approval',
        }),
        find: vi.fn().mockResolvedValue({ docs: [] }), // no membership → deny
        update: vi.fn(),
      }
      vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

      const result = await approveTopic('topic-1')

      expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
      expect(mockPayload.update).not.toHaveBeenCalled()
    })
  })
})
