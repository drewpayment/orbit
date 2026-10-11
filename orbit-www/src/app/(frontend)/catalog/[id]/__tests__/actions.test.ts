import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn(), check: vi.fn() }))
vi.mock('@/lib/authz/policy', () => ({ ALL_ROLES: ['owner', 'admin', 'member'] }))
vi.mock('@/lib/catalog/entity-types', () => ({ resolveEntityType: vi.fn() }))

import { getPayload } from 'payload'
import { getActor, check } from '@/lib/authz'
import { getCatalogEntityDetail } from '../actions'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

describe('getCatalogEntityDetail linked knowledge docs', () => {
  let payload: { findByID: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    payload = {
      findByID: vi.fn().mockResolvedValue({ id: 'e-1', slug: 'billing', workspace: 'ws-1', source: { type: 'manual' } }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(check as any).mockResolvedValue({ allowed: false, reason: 'x', actor })
  })

  it('reads knowledge pages under the actor access rules, not as a global override', async () => {
    await getCatalogEntityDetail('e-1')

    const knowledgeCall = payload.find.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.collection === 'knowledge-pages')
    expect(knowledgeCall).toBeDefined()
    expect(knowledgeCall).toMatchObject({ user: actor.user, overrideAccess: false })
  })

  it('returns null for unauthenticated callers', async () => {
    ;(getActor as any).mockResolvedValue(null)
    await expect(getCatalogEntityDetail('e-1')).resolves.toBeNull()
  })
})
