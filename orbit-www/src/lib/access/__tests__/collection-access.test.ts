/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Access, Payload } from 'payload'
import {
  adminOnly,
  workspaceScopedRead,
  memberCreate,
  manageCreate,
  docWorkspaceMutate,
  type DocWorkspaceResolver,
} from '../collection-access'
import * as scorecards from '@/collections/scorecards/access'
import * as actions from '@/collections/actions/access'
import * as automations from '@/collections/automations/access'

/**
 * Hand-rolled payload mock (mirrors src/lib/catalog/entity-authz.test.ts). `members`
 * is the workspace-member fixture the `workspace-members` collection returns; the
 * mock filters it against the `where.and` clauses the shared helpers build. `byId`
 * backs `findByID` for the doc-mutate factory and its indirect resolvers.
 */
type MemberDoc = { workspace: string; user: string; role: string; status: string }

function makePayload(members: MemberDoc[], byId: Record<string, unknown> = {}) {
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
  const findByID = vi.fn(async (args: any) => {
    const doc = byId[args.id]
    if (!doc) throw new Error('not found')
    return doc
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { payload: { find, findByID } as unknown as Payload, find, findByID }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const invoke = (
  access: Access,
  ctx: { user?: unknown; payload?: Payload; data?: unknown; id?: unknown },
) => access({ req: { user: ctx.user, payload: ctx.payload }, data: ctx.data, id: ctx.id } as any)
/* eslint-enable @typescript-eslint/no-explicit-any */

const member = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({
  workspace,
  user,
  role,
  status: 'active',
})

// id and betterAuthId deliberately differ: membership queries MUST key on
// betterAuthId, never the Payload doc id (bug-2 regression guard).
const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const superAdmin = { id: 'payload-9', betterAuthId: 'ba-9', role: 'super_admin', collection: 'users' }
const adminUser = { id: 'payload-8', betterAuthId: 'ba-8', role: 'admin', collection: 'users' }

describe('adminOnly', () => {
  beforeEach(() => vi.clearAllMocks())

  it('grants platform admins (super_admin, admin)', () => {
    expect(invoke(adminOnly, { user: superAdmin })).toBe(true)
    expect(invoke(adminOnly, { user: adminUser })).toBe(true)
  })

  it('denies role:user (bug-1 regression guard: no bypass for a plain users-collection account)', () => {
    expect(invoke(adminOnly, { user: plainUser })).toBe(false)
  })

  it('denies anonymous', () => {
    expect(invoke(adminOnly, { user: null })).toBe(false)
  })
})

describe('workspaceScopedRead', () => {
  beforeEach(() => vi.clearAllMocks())

  it('denies anonymous', async () => {
    const { payload, find } = makePayload([])
    expect(await invoke(workspaceScopedRead(), { user: null, payload })).toBe(false)
    expect(find).not.toHaveBeenCalled()
  })

  it('returns true for a platform admin without a membership query', async () => {
    const { payload, find } = makePayload([])
    expect(await invoke(workspaceScopedRead(), { user: superAdmin, payload })).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })

  it('role:user gets a workspace filter, never true (bug-1 regression guard)', async () => {
    const { payload } = makePayload([member('member')])
    const result = await invoke(workspaceScopedRead(), { user: plainUser, payload })
    expect(result).toEqual({ workspace: { in: ['ws-1'] } })
  })

  it('keys the membership query on betterAuthId, not the Payload doc id (bug-2 regression guard)', async () => {
    const { payload, find } = makePayload([member('member')])
    await invoke(workspaceScopedRead(), { user: plainUser, payload })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'workspace-members',
        where: expect.objectContaining({
          and: expect.arrayContaining([{ user: { equals: 'ba-1' } }]),
        }),
      }),
    )
  })

  it('filters a non-member to an empty set', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-OTHER')])
    expect(await invoke(workspaceScopedRead(), { user: plainUser, payload })).toEqual({
      workspace: { in: [] },
    })
  })

  it('supports a custom field name', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(workspaceScopedRead({ field: 'ownerWorkspace' }), { user: plainUser, payload }),
    ).toEqual({ ownerWorkspace: { in: ['ws-1'] } })
  })

  it('ORs a multi-field filter (KafkaLineageEdge / KafkaTopicShares shape)', async () => {
    const { payload } = makePayload([member('member', 'ws-1'), member('member', 'ws-2')])
    expect(
      await invoke(workspaceScopedRead({ fields: ['sourceWorkspace', 'targetWorkspace'] }), {
        user: plainUser,
        payload,
      }),
    ).toEqual({
      or: [{ sourceWorkspace: { in: ['ws-1', 'ws-2'] } }, { targetWorkspace: { in: ['ws-1', 'ws-2'] } }],
    })
  })

  it('role-restricted variant reads only owner/admin workspaces (KafkaApplicationQuotas)', async () => {
    const { payload } = makePayload([member('member', 'ws-1'), member('owner', 'ws-2')])
    expect(await invoke(workspaceScopedRead({ scope: 'manage' }), { user: plainUser, payload })).toEqual({
      workspace: { in: ['ws-2'] },
    })
  })

  it('missing betterAuthId yields an empty filter without querying', async () => {
    const { payload, find } = makePayload([member('member')])
    expect(
      await invoke(workspaceScopedRead(), { user: { ...plainUser, betterAuthId: undefined }, payload }),
    ).toEqual({ workspace: { in: [] } })
    expect(find).not.toHaveBeenCalled()
  })
})

describe('memberCreate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('denies anonymous', async () => {
    const { payload } = makePayload([])
    expect(await invoke(memberCreate(), { user: null, payload, data: { workspace: 'ws-1' } })).toBe(false)
  })

  it('grants a platform admin without a query', async () => {
    const { payload, find } = makePayload([])
    expect(await invoke(memberCreate(), { user: superAdmin, payload, data: { workspace: 'ws-1' } })).toBe(
      true,
    )
    expect(find).not.toHaveBeenCalled()
  })

  it('grants an active member (any role) of data.workspace', async () => {
    const { payload } = makePayload([member('member')])
    expect(await invoke(memberCreate(), { user: plainUser, payload, data: { workspace: 'ws-1' } })).toBe(
      true,
    )
  })

  it('denies a non-member of data.workspace', async () => {
    const { payload } = makePayload([member('member')])
    expect(await invoke(memberCreate(), { user: plainUser, payload, data: { workspace: 'ws-2' } })).toBe(
      false,
    )
  })

  it('denies a non-admin when data.workspace is missing/null', async () => {
    const { payload } = makePayload([member('owner')])
    expect(await invoke(memberCreate(), { user: plainUser, payload, data: {} })).toBe(false)
    expect(await invoke(memberCreate(), { user: plainUser, payload, data: { workspace: null } })).toBe(
      false,
    )
  })

  it('keys the membership query on betterAuthId (bug-2 regression guard)', async () => {
    const { payload, find } = makePayload([member('member')])
    await invoke(memberCreate(), { user: plainUser, payload, data: { workspace: 'ws-1' } })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          and: expect.arrayContaining([{ user: { equals: 'ba-1' } }]),
        }),
      }),
    )
  })

  it('supports a custom workspace field (ownerWorkspace)', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(memberCreate({ field: 'ownerWorkspace' }), {
        user: plainUser,
        payload,
        data: { ownerWorkspace: 'ws-1' },
      }),
    ).toBe(true)
  })

  it('missing betterAuthId is treated as non-member (deny, no throw)', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(memberCreate(), {
        user: { ...plainUser, betterAuthId: undefined },
        payload,
        data: { workspace: 'ws-1' },
      }),
    ).toBe(false)
  })
})

describe('manageCreate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('grants an owner/admin of data.workspace', async () => {
    const { payload } = makePayload([member('admin')])
    expect(
      await invoke(manageCreate(['owner', 'admin']), { user: plainUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(true)
  })

  it('denies a plain member (role gating: manage-create needs owner/admin)', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(manageCreate(['owner', 'admin']), { user: plainUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(false)
  })

  it('grants a platform admin without a query', async () => {
    const { payload, find } = makePayload([])
    expect(
      await invoke(manageCreate(['owner', 'admin']), { user: adminUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })

  it('denies a non-admin with missing data.workspace', async () => {
    const { payload } = makePayload([member('owner')])
    expect(await invoke(manageCreate(['owner', 'admin']), { user: plainUser, payload, data: {} })).toBe(false)
  })
})

describe('docWorkspaceMutate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('denies anonymous and missing id', async () => {
    const { payload } = makePayload([])
    expect(await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: null, payload, id: 'd1' })).toBe(
      false,
    )
    expect(
      await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: plainUser, payload }),
    ).toBe(false)
  })

  it('grants a platform admin without loading the doc', async () => {
    const { payload, findByID } = makePayload([])
    expect(
      await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: superAdmin, payload, id: 'd1' }),
    ).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('grants an owner/admin of the doc workspace (direct field default)', async () => {
    const { payload } = makePayload([member('admin')], { d1: { id: 'd1', workspace: 'ws-1' } })
    expect(
      await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: plainUser, payload, id: 'd1' }),
    ).toBe(true)
  })

  it('denies a plain member when roles require owner/admin', async () => {
    const { payload } = makePayload([member('member')], { d1: { id: 'd1', workspace: 'ws-1' } })
    expect(
      await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: plainUser, payload, id: 'd1' }),
    ).toBe(false)
  })

  it('denies when the doc has no workspace', async () => {
    const { payload } = makePayload([member('owner')], { d1: { id: 'd1' } })
    expect(
      await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: plainUser, payload, id: 'd1' }),
    ).toBe(false)
  })

  it('resolves an indirect workspace via a custom resolver (KafkaOffsetCheckpoints shape)', async () => {
    // doc -> virtualCluster -> application -> workspace
    const byId = {
      chk1: { id: 'chk1', virtualCluster: 'vc1' },
      vc1: { id: 'vc1', application: 'app1' },
      app1: { id: 'app1', workspace: 'ws-1' },
    }
    const { payload, findByID } = makePayload([member('owner')], byId)
    const load = (id: string) =>
      payload.findByID({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        collection: 'kafka' as any,
        id,
        overrideAccess: true,
      }) as Promise<Record<string, string>>
    const resolveWorkspace: DocWorkspaceResolver = async ({ doc }) => {
      const vc = await load((doc as Record<string, string>).virtualCluster)
      const app = await load(vc.application)
      return app.workspace
    }
    expect(
      await invoke(docWorkspaceMutate('kafka-offset-checkpoints', ['owner', 'admin'], { resolveWorkspace }), {
        user: plainUser,
        payload,
        id: 'chk1',
      }),
    ).toBe(true)
    expect(findByID).toHaveBeenCalled()
  })

  it('keys the membership query on betterAuthId (bug-2 regression guard)', async () => {
    const { payload, find } = makePayload([member('admin')], { d1: { id: 'd1', workspace: 'ws-1' } })
    await invoke(docWorkspaceMutate('scorecards', ['owner', 'admin']), { user: plainUser, payload, id: 'd1' })
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          and: expect.arrayContaining([{ user: { equals: 'ba-1' } }]),
        }),
      }),
    )
  })
})

describe('scorecards/access adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('workspaceScopedRead scopes to member workspaces', async () => {
    const { payload } = makePayload([member('member')])
    expect(await invoke(scorecards.workspaceScopedRead, { user: plainUser, payload })).toEqual({
      workspace: { in: ['ws-1'] },
    })
  })

  it('workspaceScopedCreate now denies a non-member (policy change from !!user)', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(scorecards.workspaceScopedCreate, { user: plainUser, payload, data: { workspace: 'ws-2' } }),
    ).toBe(false)
    expect(
      await invoke(scorecards.workspaceScopedCreate, { user: plainUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(true)
  })

  it('workspaceScopedManageCreate requires owner/admin', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(scorecards.workspaceScopedManageCreate, { user: plainUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(false)
  })

  it('workspaceScopedMutate(slug, roles) gates on the doc workspace', async () => {
    const { payload } = makePayload([member('admin')], { d1: { id: 'd1', workspace: 'ws-1' } })
    expect(
      await invoke(scorecards.workspaceScopedMutate('scorecards', ['owner', 'admin']), {
        user: plainUser,
        payload,
        id: 'd1',
      }),
    ).toBe(true)
  })
})

describe('actions/access adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('workspaceScopedMemberCreate grants an active member', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(actions.workspaceScopedMemberCreate, { user: plainUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(true)
  })

  it('workspaceScopedManageCreate denies a plain member', async () => {
    const { payload } = makePayload([member('member')])
    expect(
      await invoke(actions.workspaceScopedManageCreate, { user: plainUser, payload, data: { workspace: 'ws-1' } }),
    ).toBe(false)
  })
})

describe('automations/access adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('workspaceScopedManageMutate gates on owner/admin of the automation workspace', async () => {
    const { payload } = makePayload([member('admin')], { a1: { id: 'a1', workspace: 'ws-1' } })
    expect(
      await invoke(automations.workspaceScopedManageMutate, { user: plainUser, payload, id: 'a1' }),
    ).toBe(true)
  })

  it('workspaceScopedManageMutate denies a plain member', async () => {
    const { payload } = makePayload([member('member')], { a1: { id: 'a1', workspace: 'ws-1' } })
    expect(
      await invoke(automations.workspaceScopedManageMutate, { user: plainUser, payload, id: 'a1' }),
    ).toBe(false)
  })

  it('workspaceScopedManageMutate denies anonymous', async () => {
    const { payload } = makePayload([])
    expect(await invoke(automations.workspaceScopedManageMutate, { user: null, payload, id: 'a1' })).toBe(false)
  })
})
