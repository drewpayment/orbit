import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(),
  memberWorkspaceIds: vi.fn(),
}))

import { getPayload } from 'payload'
import { getActor, memberWorkspaceIds } from '@/lib/authz'
import { getAPIById, getAPIVersions, getAllWorkspaces, getAllTags } from '../actions'

const actor = {
  payloadId: 'pl-1',
  betterAuthId: 'ba-1',
  email: 'a@test.com',
  role: 'user',
  isPlatformAdmin: false,
  user: { id: 'pl-1', collection: 'users' },
}

function makePayload() {
  return {
    find: vi.fn().mockResolvedValue({ docs: [] }),
    findByID: vi.fn(),
  }
}

/** Serialise a where clause so tests can assert on its visibility shape. */
const whereOf = (call: any[]) => JSON.stringify(call[0].where)

describe('catalog API actions: visibility scoping', () => {
  let payload: ReturnType<typeof makePayload>

  beforeEach(() => {
    vi.clearAllMocks()
    payload = makePayload()
    ;(getPayload as any).mockResolvedValue(payload)
    ;(getActor as any).mockResolvedValue(actor)
    ;(memberWorkspaceIds as any).mockResolvedValue(['ws-1'])
  })

  describe('getAPIById', () => {
    it('anonymous callers only see public, non-draft schemas', async () => {
      ;(getActor as any).mockResolvedValue(null)
      await getAPIById('schema-1')
      const w = whereOf(payload.find.mock.calls[0])
      expect(w).toContain('"visibility":{"equals":"public"}')
      expect(w).toContain('"status":{"not_equals":"draft"}')
      expect(w).not.toContain('workspace')
      expect(w).not.toContain('private')
    })

    it('members get their workspace-visibility schemas, not arbitrary ones', async () => {
      await getAPIById('schema-1')
      const w = whereOf(payload.find.mock.calls[0])
      expect(w).toContain('"workspace":{"in":["ws-1"]}')
      expect(w).toContain('"createdBy":{"equals":"pl-1"}')
      expect(w).toContain('"id":{"equals":"schema-1"}')
    })

    it('returns null when the schema is not visible to the caller', async () => {
      payload.find.mockResolvedValue({ docs: [] })
      await expect(getAPIById('schema-1')).resolves.toBeNull()
    })

    it('returns the schema when visible', async () => {
      payload.find.mockResolvedValue({ docs: [{ id: 'schema-1' }] })
      await expect(getAPIById('schema-1')).resolves.toEqual({ id: 'schema-1' })
    })
  })

  describe('getAPIVersions', () => {
    it('returns nothing and never reads versions when the schema is not visible', async () => {
      payload.find.mockResolvedValue({ docs: [] })
      await expect(getAPIVersions('schema-1')).resolves.toEqual([])
      expect(payload.find).toHaveBeenCalledTimes(1)
      expect(payload.find.mock.calls[0][0].collection).toBe('api-schemas')
    })

    it('reads versions once the schema is visible', async () => {
      payload.find
        .mockResolvedValueOnce({ docs: [{ id: 'schema-1' }] })
        .mockResolvedValueOnce({ docs: [{ id: 'v1' }] })
      await expect(getAPIVersions('schema-1')).resolves.toEqual([{ id: 'v1' }])
    })
  })

  describe('getAllTags', () => {
    it('only aggregates tags from schemas the caller can see', async () => {
      payload.find.mockResolvedValue({ docs: [{ tags: [{ tag: 'b' }, { tag: 'a' }] }] })
      const tags = await getAllTags()
      expect(tags).toEqual(['a', 'b'])
      const w = whereOf(payload.find.mock.calls[0])
      expect(w).toContain('"visibility":{"equals":"public"}')
      expect(w).toContain('"workspace":{"in":["ws-1"]}')
    })
  })

  describe('getAllWorkspaces', () => {
    it('returns [] for unauthenticated callers without querying', async () => {
      ;(getActor as any).mockResolvedValue(null)
      await expect(getAllWorkspaces()).resolves.toEqual([])
      expect(payload.find).not.toHaveBeenCalled()
    })

    it('lists workspaces through collection access as the actor', async () => {
      payload.find.mockResolvedValue({ docs: [{ id: 'ws-1' }] })
      await expect(getAllWorkspaces()).resolves.toEqual([{ id: 'ws-1' }])
      expect(payload.find.mock.calls[0][0]).toMatchObject({
        collection: 'workspaces',
        user: actor.user,
        overrideAccess: false,
      })
    })
  })
})
