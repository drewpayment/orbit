import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/mongodb', () => ({ getMongoClient: vi.fn() }))
vi.mock('@/lib/workspaces/members', () => ({ listActiveMembershipDocsFor: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn() }))
// React.cache memoises by argument within a request; make it transparent for unit tests.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

import { getPayload } from 'payload'
import { getActor } from '@/lib/authz'
import {
  getKnowledgeSpaceBySlug,
  getKnowledgePagesBySpace,
  getKnowledgePageBySlug,
} from './cached-queries'

const actor = { payloadId: 'pl-1', user: { id: 'pl-1', collection: 'users' } }

describe('knowledge fetchers run as the session actor', () => {
  let payload: { find: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    payload = { find: vi.fn().mockResolvedValue({ docs: [{ id: 'x' }] }) }
    ;(getPayload as any).mockResolvedValue(payload)
  })

  it('returns nothing and never queries without a session', async () => {
    ;(getActor as any).mockResolvedValue(null)
    await expect(getKnowledgeSpaceBySlug('s', 'ws-1')).resolves.toBeNull()
    await expect(getKnowledgePagesBySpace('sp-1')).resolves.toEqual([])
    await expect(getKnowledgePageBySlug('p', 'sp-1')).resolves.toBeNull()
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('applies collection access as the actor (Payload local API defaults to override)', async () => {
    ;(getActor as any).mockResolvedValue(actor)
    await getKnowledgeSpaceBySlug('s', 'ws-1')
    await getKnowledgePagesBySpace('sp-1')
    await getKnowledgePageBySlug('p', 'sp-1')
    expect(payload.find).toHaveBeenCalledTimes(3)
    for (const call of payload.find.mock.calls) {
      expect(call[0]).toMatchObject({ user: actor.user, overrideAccess: false })
    }
  })
})
