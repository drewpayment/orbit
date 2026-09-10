import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import { ValidationError } from 'payload'

/**
 * A small in-memory fake of the Payload local API for `template-skeletons`
 * CRUD — mirrors the fake in `../authoring-actions.test.ts` (same
 * `find`/`findByID`/`create`/`update`/`delete` shapes, same
 * single-workspace-role simulation), kept local rather than shared since a
 * `'use server'` module may only export async functions.
 */
function makeFakePayload(opts?: { membershipRole?: string | null }) {
  const store = new Map<string, Map<string, Record<string, unknown>>>()
  let seq = 0
  let membershipRole: string | null = opts?.membershipRole ?? 'owner'

  const col = (name: string) => {
    let m = store.get(name)
    if (!m) {
      m = new Map()
      store.set(name, m)
    }
    return m
  }

  function matchesClause(doc: Record<string, unknown>, clause: Record<string, unknown>): boolean {
    return Object.entries(clause).every(([field, cond]) => {
      if (field === 'and') return (cond as Record<string, unknown>[]).every((c) => matchesClause(doc, c))
      if (field === 'or') return (cond as Record<string, unknown>[]).some((c) => matchesClause(doc, c))
      const value = doc[field]
      const c = cond as Record<string, unknown>
      if ('equals' in c) return String(value) === String(c.equals)
      if ('in' in c) return (c.in as unknown[]).map(String).includes(String(value))
      return true
    })
  }

  const find = vi.fn(async ({ collection, where, sort, limit }: Record<string, unknown>) => {
    if (collection === 'workspace-members') {
      if (!membershipRole) return { docs: [] }
      const membershipDoc = { id: 'm-1', role: membershipRole, status: 'active', workspace: WORKSPACE_ID, user: 'user-1' }
      const docs = where && !matchesClause(membershipDoc, where as Record<string, unknown>) ? [] : [membershipDoc]
      return { docs }
    }
    let docs = [...col(collection as string).values()]
    if (where) docs = docs.filter((d) => matchesClause(d, where as Record<string, unknown>))
    if (typeof sort === 'string' && sort.startsWith('-')) {
      const field = sort.slice(1)
      docs = [...docs].sort((a, b) => Number(b[field] ?? 0) - Number(a[field] ?? 0))
    }
    if (typeof limit === 'number') docs = docs.slice(0, limit)
    return { docs }
  })

  const findByID = vi.fn(async ({ collection, id }: Record<string, unknown>) => {
    const doc = col(collection as string).get(String(id))
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return { ...doc }
  })

  const create = vi.fn(async ({ collection, data }: Record<string, unknown>) => {
    const id = `${collection as string}-${++seq}`
    const doc = { id, updatedAt: new Date().toISOString(), ...(data as Record<string, unknown>) }
    col(collection as string).set(id, doc)
    return { ...doc }
  })

  const update = vi.fn(async ({ collection, id, data }: Record<string, unknown>) => {
    const existing = col(collection as string).get(String(id))
    if (!existing) throw new Error(`${collection}/${id} not found`)
    const merged = { ...existing, ...(data as Record<string, unknown>) }
    col(collection as string).set(String(id), merged)
    return { ...merged }
  })

  const del = vi.fn(async ({ collection, id }: Record<string, unknown>) => {
    col(collection as string).delete(String(id))
    return { id }
  })

  const payload = { find, findByID, create, update, delete: del } as unknown as Payload
  return {
    payload,
    find,
    findByID,
    create,
    update,
    delete: del,
    col,
    setMembershipRole: (role: string | null) => {
      membershipRole = role
    },
  }
}

let mockPayload: ReturnType<typeof makeFakePayload>['payload']
let mockSessionUser: { id: string } | null = { id: 'user-1' }
let mockPayloadUser: { id: string; role?: string } | null = { id: 'payload-user-1', role: 'member' }

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', async () => {
  const actual = await vi.importActual<typeof import('payload')>('payload')
  return { ...actual, getPayload: vi.fn(async () => mockPayload) }
})
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => mockSessionUser),
  getPayloadUserFromSession: vi.fn(async () => mockPayloadUser),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const WORKSPACE_ID = 'ws-1'
const OTHER_WORKSPACE_ID = 'ws-2'

const SKELETON_ROW = {
  id: 'skel-1',
  workspace: WORKSPACE_ID,
  name: 'Go service',
  slug: 'go-service',
  description: 'A starter',
  files: [{ path: 'main.go', content: 'package main', size: 13, isBinary: false }],
  version: 1,
  totalSize: 13,
  createdBy: 'user-1',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// A skeleton owned by a DIFFERENT workspace than the caller's own — the
// fake's `workspace-members` stub only ever grants membership in
// WORKSPACE_ID, so any check against OTHER_WORKSPACE_ID naturally comes
// back empty, exactly like a real cross-tenant caller.
const OTHER_WORKSPACE_SKELETON_ROW = {
  ...SKELETON_ROW,
  id: 'skel-2',
  workspace: OTHER_WORKSPACE_ID,
  slug: 'other-workspace-service',
}

describe('skeletons/skeleton-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockSessionUser = { id: 'user-1' }
    mockPayloadUser = { id: 'payload-user-1', role: 'member' }
  })

  it('listSkeletons returns [] for a non-member', async () => {
    const fake = makeFakePayload()
    fake.setMembershipRole(null)
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { listSkeletons } = await import('./skeleton-actions')
    expect(await listSkeletons(WORKSPACE_ID)).toEqual([])
  })

  it('listSkeletons returns summaries for an active member', async () => {
    const fake = makeFakePayload({ membershipRole: 'member' })
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { listSkeletons } = await import('./skeleton-actions')
    const items = await listSkeletons(WORKSPACE_ID)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'skel-1', name: 'Go service', slug: 'go-service', fileCount: 1 })
  })

  it('getSkeleton returns null for a skeleton in a workspace the caller cannot see', async () => {
    const fake = makeFakePayload()
    fake.setMembershipRole(null)
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { getSkeleton } = await import('./skeleton-actions')
    expect(await getSkeleton('skel-1')).toBeNull()
  })

  it('getSkeleton returns null (never throws) for a missing id', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    mockPayload = fake.payload
    const { getSkeleton } = await import('./skeleton-actions')
    expect(await getSkeleton('nope')).toBeNull()
  })

  it('getSkeleton returns full file contents for a member', async () => {
    const fake = makeFakePayload({ membershipRole: 'member' })
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { getSkeleton } = await import('./skeleton-actions')
    const detail = await getSkeleton('skel-1')
    expect(detail?.files).toEqual([{ path: 'main.go', content: 'package main' }])
  })

  it('createSkeleton rejects a plain member (owner/admin required)', async () => {
    const fake = makeFakePayload({ membershipRole: 'member' })
    mockPayload = fake.payload
    const { createSkeleton } = await import('./skeleton-actions')
    const result = await createSkeleton({
      workspaceId: WORKSPACE_ID,
      name: 'New',
      slug: 'new',
      files: [{ path: 'a.txt', content: 'hi' }],
    })
    expect(result.ok).toBe(false)
    expect(fake.create).not.toHaveBeenCalled()
  })

  it('createSkeleton creates a document for an owner', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    mockPayload = fake.payload
    const { createSkeleton } = await import('./skeleton-actions')
    const result = await createSkeleton({
      workspaceId: WORKSPACE_ID,
      name: 'New skeleton',
      slug: 'new-skeleton',
      files: [{ path: 'a.txt', content: 'hi' }],
    })
    expect(result.ok).toBe(true)
    expect(fake.create).toHaveBeenCalledTimes(1)
  })

  it('createSkeleton rejects an invalid slug before calling Payload', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    mockPayload = fake.payload
    const { createSkeleton } = await import('./skeleton-actions')
    const result = await createSkeleton({
      workspaceId: WORKSPACE_ID,
      name: 'New',
      slug: 'Not A Slug!',
      files: [],
    })
    expect(result.ok).toBe(false)
    expect(fake.create).not.toHaveBeenCalled()
  })

  it('createSkeleton surfaces a Payload ValidationError as {ok:false, errors} rather than throwing', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    fake.create.mockRejectedValueOnce(
      new ValidationError({ errors: [{ path: 'files', message: 'A skeleton may contain at most 50 files (got 51).' }] }),
    )
    mockPayload = fake.payload
    const { createSkeleton } = await import('./skeleton-actions')
    const result = await createSkeleton({
      workspaceId: WORKSPACE_ID,
      name: 'New',
      slug: 'new',
      files: [{ path: 'a.txt', content: 'hi' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.errors.join(' ')).toContain('at most 50 files')
  })

  it('saveSkeleton rejects a plain member', async () => {
    const fake = makeFakePayload({ membershipRole: 'member' })
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { saveSkeleton } = await import('./skeleton-actions')
    const result = await saveSkeleton('skel-1', {
      name: 'Renamed',
      slug: 'go-service',
      files: [{ path: 'main.go', content: 'package main' }],
    })
    expect(result.ok).toBe(false)
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('saveSkeleton returns a not-found error for a missing id rather than throwing', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    mockPayload = fake.payload
    const { saveSkeleton } = await import('./skeleton-actions')
    const result = await saveSkeleton('nope', { name: 'X', slug: 'x', files: [] })
    expect(result.ok).toBe(false)
  })

  it('saveSkeleton persists an update for an owner', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { saveSkeleton } = await import('./skeleton-actions')
    const result = await saveSkeleton('skel-1', {
      name: 'Renamed',
      slug: 'go-service',
      files: [{ path: 'main.go', content: 'package main updated' }],
    })
    expect(result.ok).toBe(true)
    expect(fake.update).toHaveBeenCalledTimes(1)
  })

  it('deleteSkeleton rejects a plain member', async () => {
    const fake = makeFakePayload({ membershipRole: 'member' })
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { deleteSkeleton } = await import('./skeleton-actions')
    const result = await deleteSkeleton('skel-1')
    expect(result.ok).toBe(false)
    expect(fake.delete).not.toHaveBeenCalled()
  })

  it('deleteSkeleton removes the document for an admin', async () => {
    const fake = makeFakePayload({ membershipRole: 'admin' })
    fake.col('template-skeletons').set('skel-1', { ...SKELETON_ROW })
    mockPayload = fake.payload
    const { deleteSkeleton } = await import('./skeleton-actions')
    const result = await deleteSkeleton('skel-1')
    expect(result.ok).toBe(true)
    expect(fake.delete).toHaveBeenCalledTimes(1)
  })

  it('saveSkeleton rejects an owner/admin of a DIFFERENT workspace than the doc — cross-tenant guard', async () => {
    // Caller is owner/admin, but only in WORKSPACE_ID — the fake's
    // workspace-members stub grants that role solely in that workspace, so
    // a membership check against OTHER_WORKSPACE_ID (the doc's real
    // workspace) comes back empty, exactly as it would for a real
    // cross-tenant caller who happens to manage some OTHER workspace.
    const fake = makeFakePayload({ membershipRole: 'owner' })
    fake.col('template-skeletons').set('skel-2', { ...OTHER_WORKSPACE_SKELETON_ROW })
    mockPayload = fake.payload
    const { saveSkeleton } = await import('./skeleton-actions')
    const result = await saveSkeleton('skel-2', {
      name: 'Hijacked',
      slug: 'other-workspace-service',
      files: [{ path: 'main.go', content: 'package main // tampered' }],
    })
    expect(result.ok).toBe(false)
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('deleteSkeleton rejects an owner/admin of a DIFFERENT workspace than the doc — cross-tenant guard', async () => {
    const fake = makeFakePayload({ membershipRole: 'admin' })
    fake.col('template-skeletons').set('skel-2', { ...OTHER_WORKSPACE_SKELETON_ROW })
    mockPayload = fake.payload
    const { deleteSkeleton } = await import('./skeleton-actions')
    const result = await deleteSkeleton('skel-2')
    expect(result.ok).toBe(false)
    expect(fake.delete).not.toHaveBeenCalled()
  })

  it('every mutation throws "Not authenticated" with no session', async () => {
    const fake = makeFakePayload({ membershipRole: 'owner' })
    mockPayload = fake.payload
    mockSessionUser = null
    const { createSkeleton, saveSkeleton, deleteSkeleton } = await import('./skeleton-actions')
    await expect(createSkeleton({ workspaceId: WORKSPACE_ID, name: 'X', slug: 'x', files: [] })).rejects.toThrow(
      'Not authenticated',
    )
    await expect(saveSkeleton('skel-1', { name: 'X', slug: 'x', files: [] })).rejects.toThrow('Not authenticated')
    await expect(deleteSkeleton('skel-1')).rejects.toThrow('Not authenticated')
  })
})
