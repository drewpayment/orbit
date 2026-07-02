import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import {
  canCreateEntity,
  canManageEntity,
  canDeleteEntity,
  getManageableWorkspaceIds,
  isTeamEntity,
} from './entity-authz'

/**
 * Hand-rolled payload mock. `members` is the list of workspace-member docs the
 * `workspace-members` collection returns; the mock filters it against the
 * `where.and` clauses the authz helpers build (workspace + user + role + status)
 * so a single fixture drives member/admin/non-member cases.
 */
function makePayload(members: { workspace: string; user: string; role: string; status: string }[]) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const find = vi.fn(async (args: any) => {
    if (args.collection !== 'workspace-members') return { docs: [] }
    const and: any[] = args.where?.and ?? []
    const filtered = members.filter((m) =>
      and.every((cond) => {
        if (cond.workspace) return m.workspace === cond.workspace.equals
        if (cond.user) return m.user === cond.user.equals
        if (cond.status) return m.status === cond.status.equals
        if (cond.role?.equals) return m.role === cond.role.equals
        if (cond.role?.in) return cond.role.in.includes(m.role)
        return true
      }),
    )
    return { docs: filtered }
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { payload: { find } as unknown as Payload, find }
}

const memberDoc = (role: string) => ({ workspace: 'ws-1', user: 'ba-1', role, status: 'active' })

describe('canCreateEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets a platform admin create anywhere without a membership query', async () => {
    const { payload, find } = makePayload([])
    expect(await canCreateEntity(payload, 'ba-1', true, 'ws-1')).toBe(true)
    expect(await canCreateEntity(payload, 'ba-1', true, null)).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })

  it('lets an active member (any role) create into their workspace', async () => {
    const { payload } = makePayload([memberDoc('member')])
    expect(await canCreateEntity(payload, 'ba-1', false, 'ws-1')).toBe(true)
  })

  it('denies a non-member', async () => {
    const { payload } = makePayload([memberDoc('member')])
    expect(await canCreateEntity(payload, 'ba-1', false, 'ws-2')).toBe(false)
  })

  it('denies a non-admin for a global (null-workspace) entity', async () => {
    const { payload, find } = makePayload([memberDoc('owner')])
    expect(await canCreateEntity(payload, 'ba-1', false, null)).toBe(false)
    expect(find).not.toHaveBeenCalled()
  })

  it('denies when betterAuthId is missing', async () => {
    const { payload } = makePayload([memberDoc('owner')])
    expect(await canCreateEntity(payload, null, false, 'ws-1')).toBe(false)
  })
})

describe('canManageEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('mirrors create against the entity workspace', async () => {
    const { payload } = makePayload([memberDoc('member')])
    expect(await canManageEntity(payload, 'ba-1', false, { workspaceId: 'ws-1' })).toBe(true)
    expect(await canManageEntity(payload, 'ba-1', false, { workspaceId: 'ws-2' })).toBe(false)
  })

  it('admin-only for a global entity', async () => {
    const { payload } = makePayload([memberDoc('owner')])
    expect(await canManageEntity(payload, 'ba-1', false, { workspaceId: null })).toBe(false)
    expect(await canManageEntity(payload, 'ba-1', true, { workspaceId: null })).toBe(true)
  })
})

describe('canDeleteEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('denies a projected entity even for a platform admin', async () => {
    const { payload } = makePayload([])
    expect(
      await canDeleteEntity(payload, 'ba-1', true, { workspaceId: 'ws-1', sourceType: 'apps' }),
    ).toBe(false)
  })

  it('allows a workspace owner/admin to delete a manual entity', async () => {
    const { payload } = makePayload([memberDoc('admin')])
    expect(
      await canDeleteEntity(payload, 'ba-1', false, { workspaceId: 'ws-1', sourceType: 'manual' }),
    ).toBe(true)
  })

  it('denies a plain member deleting a manual entity (delete needs owner/admin)', async () => {
    const { payload } = makePayload([memberDoc('member')])
    expect(
      await canDeleteEntity(payload, 'ba-1', false, { workspaceId: 'ws-1', sourceType: 'manual' }),
    ).toBe(false)
  })

  it('allows a platform admin to delete a manual global entity', async () => {
    const { payload } = makePayload([])
    expect(
      await canDeleteEntity(payload, 'ba-1', true, { workspaceId: null, sourceType: 'manual' }),
    ).toBe(true)
  })

  it('denies a non-admin deleting a manual global entity', async () => {
    const { payload } = makePayload([memberDoc('owner')])
    expect(
      await canDeleteEntity(payload, 'ba-1', false, { workspaceId: null, sourceType: 'manual' }),
    ).toBe(false)
  })
})

describe('getManageableWorkspaceIds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns active membership workspace ids', async () => {
    const { payload } = makePayload([
      { workspace: 'ws-1', user: 'ba-1', role: 'member', status: 'active' },
      { workspace: 'ws-2', user: 'ba-1', role: 'owner', status: 'active' },
    ])
    expect(await getManageableWorkspaceIds(payload, 'ba-1')).toEqual(['ws-1', 'ws-2'])
  })

  it('returns [] for a missing id without querying', async () => {
    const { payload, find } = makePayload([])
    expect(await getManageableWorkspaceIds(payload, null)).toEqual([])
    expect(find).not.toHaveBeenCalled()
  })
})


describe('isTeamEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is true for an existing entity of kind team', async () => {
    const payload = {
      findByID: vi.fn(async () => ({ id: 'e1', kind: 'team' })),
    } as unknown as Payload
    expect(await isTeamEntity(payload, 'e1')).toBe(true)
  })

  it('is false for an existing non-team entity', async () => {
    const payload = {
      findByID: vi.fn(async () => ({ id: 'e1', kind: 'service' })),
    } as unknown as Payload
    expect(await isTeamEntity(payload, 'e1')).toBe(false)
  })

  it('is false when the entity does not exist (findByID throws)', async () => {
    const payload = {
      findByID: vi.fn(async () => {
        throw new Error('not found')
      }),
    } as unknown as Payload
    expect(await isTeamEntity(payload, 'missing')).toBe(false)
  })
})
