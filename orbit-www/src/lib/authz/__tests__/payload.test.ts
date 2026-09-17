/**
 * @vitest-environment node
 *
 * Covers the adapter options added in Phase B (via, includeGlobal, extend,
 * anonymous, scope:'owner', guard, ownerField, authenticatedOnly, denyAll).
 * The original five factories are covered by lib/access/__tests__/collection-access.test.ts.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload, Where } from 'payload'
import {
  workspaceScopedRead,
  memberCreate,
  docWorkspaceMutate,
  authenticatedOnly,
  denyAll,
  NOTHING,
} from '../payload'

type MemberDoc = { workspace: string; user: string; role: string; status: string }
type Rows = Record<string, Array<Record<string, unknown>>>

function makePayload(members: MemberDoc[], rows: Rows = {}, byId: Record<string, unknown> = {}) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const find = vi.fn(async (args: any) => {
    if (args.collection === 'workspace-members') {
      const and: any[] = args.where?.and ?? []
      return {
        docs: members.filter((m) =>
          and.every((c) => {
            if (c.workspace) return m.workspace === c.workspace.equals
            if (c.user) return m.user === c.user.equals
            if (c.status) return m.status === c.status.equals
            if (c.role?.equals) return m.role === c.role.equals
            if (c.role?.in) return c.role.in.includes(m.role)
            return true
          }),
        ),
      }
    }
    const [field, cond] = Object.entries(args.where ?? {})[0] as [string, any]
    const set: string[] = cond?.in ?? []
    return { docs: (rows[args.collection] ?? []).filter((r) => set.includes(String(r[field]))) }
  })
  const findByID = vi.fn(async (args: any) => {
    const doc = byId[args.id]
    if (!doc) throw new Error('not found')
    return doc
  })
  const invoke = (access: Access, ctx: { user?: unknown; data?: unknown; id?: unknown }) =>
    access({ req: { user: ctx.user, payload: { find, findByID } as unknown as Payload }, data: ctx.data, id: ctx.id } as any)
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { find, findByID, invoke }
}

const active = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({ workspace, user, role, status: 'active' })
const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const adminUser = { id: 'payload-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }

describe('workspaceScopedRead: via (indirect joins)', () => {
  it('one hop: deployments → apps.workspace', async () => {
    const { invoke, find } = makePayload([active('member')], { apps: [{ id: 'app-1', workspace: 'ws-1' }, { id: 'app-2', workspace: 'ws-9' }] })
    const where = await invoke(workspaceScopedRead({ via: [{ collection: 'apps', on: 'app' }] }), { user: plainUser })
    expect(where).toEqual({ app: { in: ['app-1'] } })
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'apps', where: { workspace: { in: ['ws-1'] } }, overrideAccess: true }))
  })

  it('two hops: page-links → pages.knowledgeSpace → spaces.workspace', async () => {
    const { invoke } = makePayload([active('member')], {
      'knowledge-spaces': [{ id: 'sp-1', workspace: 'ws-1' }],
      'knowledge-pages': [{ id: 'pg-1', knowledgeSpace: 'sp-1' }, { id: 'pg-2', knowledgeSpace: 'sp-other' }],
    })
    const where = await invoke(
      workspaceScopedRead({
        via: [
          { collection: 'knowledge-spaces', on: 'knowledgeSpace' },
          { collection: 'knowledge-pages', on: 'fromPage' },
        ],
      }),
      { user: plainUser },
    )
    expect(where).toEqual({ fromPage: { in: ['pg-1'] } })
  })

  it('a non-member gets a match-nothing filter without hop queries', async () => {
    const { invoke, find } = makePayload([], { apps: [{ id: 'app-1', workspace: 'ws-1' }] })
    const where = await invoke(workspaceScopedRead({ via: [{ collection: 'apps', on: 'app' }] }), { user: plainUser })
    expect(where).toEqual(NOTHING)
    expect(find.mock.calls.some((c) => c[0].collection === 'apps')).toBe(false)
  })

  it('an empty intermediate hop short-circuits to match-nothing', async () => {
    const { invoke } = makePayload([active('member')], { 'knowledge-spaces': [], 'knowledge-pages': [{ id: 'pg-1', knowledgeSpace: 'sp-1' }] })
    const where = await invoke(
      workspaceScopedRead({ via: [{ collection: 'knowledge-spaces', on: 'knowledgeSpace' }, { collection: 'knowledge-pages', on: 'fromPage' }] }),
      { user: plainUser },
    )
    expect(where).toEqual(NOTHING)
  })

  it('platform admin bypasses hops entirely', async () => {
    const { invoke, find } = makePayload([])
    expect(await invoke(workspaceScopedRead({ via: [{ collection: 'apps', on: 'app' }] }), { user: adminUser })).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })
})

describe('workspaceScopedRead: includeGlobal / extend / anonymous / scope', () => {
  it('includeGlobal ORs rows with no workspace (built-in generators)', async () => {
    const { invoke } = makePayload([active('member')])
    const where = await invoke(workspaceScopedRead({ includeGlobal: true }), { user: plainUser })
    expect(where).toEqual({ or: [{ workspace: { in: ['ws-1'] } }, { workspace: { exists: false } }] })
  })

  it('extend adds custom OR branches with the principal (Templates visibility / sharedWith)', async () => {
    const { invoke } = makePayload([active('member')])
    const where = await invoke(
      workspaceScopedRead({
        extend: ({ workspaceIds, principal }): Where[] => [
          { visibility: { equals: 'public' } },
          { sharedWith: { in: workspaceIds } },
          { createdBy: { equals: principal.payloadId } },
        ],
      }),
      { user: plainUser },
    )
    expect(where).toEqual({
      or: [
        { workspace: { in: ['ws-1'] } },
        { visibility: { equals: 'public' } },
        { sharedWith: { in: ['ws-1'] } },
        { createdBy: { equals: 'payload-1' } }, // Payload id, not ba-1
      ],
    })
  })

  it('anonymous callers get the anonymous filter, or false by default', async () => {
    const { invoke } = makePayload([])
    expect(await invoke(workspaceScopedRead({ anonymous: { visibility: { equals: 'public' } } }), { user: null })).toEqual({ visibility: { equals: 'public' } })
    expect(await invoke(workspaceScopedRead(), { user: null })).toBe(false)
  })

  it("scope 'owner' restricts to owner workspaces (Workspaces.delete shape)", async () => {
    const { invoke, find } = makePayload([active('owner', 'ws-1'), active('admin', 'ws-2')])
    const where = await invoke(workspaceScopedRead({ field: 'id', scope: 'owner' }), { user: plainUser })
    expect(where).toEqual({ id: { in: ['ws-1'] } })
    expect(find.mock.calls[0][0].where.and).toContainEqual({ role: { equals: 'owner' } })
  })

  it('adminBypass:false makes admins go through the filter', async () => {
    const { invoke } = makePayload([active('member', 'ws-1', 'ba-9')])
    expect(await invoke(workspaceScopedRead({ adminBypass: false }), { user: adminUser })).toEqual({ workspace: { in: ['ws-1'] } })
  })
})

describe('memberCreate: guard', () => {
  it('guard denies before the admin bypass (built-in rows cannot be created via API)', async () => {
    const { invoke } = makePayload([])
    const access = memberCreate({ guard: (data) => !(data as { isBuiltIn?: boolean })?.isBuiltIn })
    expect(await invoke(access, { user: adminUser, data: { isBuiltIn: true, workspace: 'ws-1' } })).toBe(false)
    expect(await invoke(access, { user: adminUser, data: { workspace: 'ws-1' } })).toBe(true)
  })
})

describe('docWorkspaceMutate: ownerField / guard', () => {
  const byId = {
    'doc-1': { id: 'doc-1', workspace: 'ws-1', author: 'payload-1' },
    'doc-2': { id: 'doc-2', workspace: 'ws-1', author: { id: 'payload-2' } },
    'builtin': { id: 'builtin', workspace: 'ws-1', isBuiltIn: true },
    'projected': { id: 'projected', workspace: 'ws-1', source: { type: 'github' } },
  }

  it('the author (Payload id) may mutate even as a plain member', async () => {
    const { invoke } = makePayload([active('member')], {}, byId)
    const access = docWorkspaceMutate('knowledge-pages', ['owner', 'admin'], { ownerField: 'author' })
    expect(await invoke(access, { user: plainUser, id: 'doc-1' })).toBe(true)
    expect(await invoke(access, { user: plainUser, id: 'doc-2' })).toBe(false)
  })

  it('ownerField never matches the Better-Auth id', async () => {
    const { invoke } = makePayload([active('member')], {}, { 'doc-ba': { id: 'doc-ba', workspace: 'ws-1', author: 'ba-1' } })
    expect(await invoke(docWorkspaceMutate('x', ['owner'], { ownerField: 'author' }), { user: plainUser, id: 'doc-ba' })).toBe(false)
  })

  it('guard denies everyone including platform admins (built-in / projected rows)', async () => {
    const { invoke } = makePayload([active('owner')], {}, byId)
    const notBuiltIn = docWorkspaceMutate('deployment-generators', ['owner', 'admin'], { guard: (d) => !d.isBuiltIn })
    expect(await invoke(notBuiltIn, { user: adminUser, id: 'builtin' })).toBe(false)
    expect(await invoke(notBuiltIn, { user: plainUser, id: 'builtin' })).toBe(false)
    const manualOnly = docWorkspaceMutate('catalog-entities', ['owner', 'admin'], {
      guard: (d) => ((d.source as { type?: string } | undefined)?.type ?? 'manual') === 'manual',
    })
    expect(await invoke(manualOnly, { user: adminUser, id: 'projected' })).toBe(false)
    expect(await invoke(manualOnly, { user: plainUser, id: 'doc-1' })).toBe(true)
  })

  it('platform admin still skips the doc load when there is no guard', async () => {
    const { invoke, findByID } = makePayload([], {}, byId)
    expect(await invoke(docWorkspaceMutate('x', ['owner']), { user: adminUser, id: 'doc-1' })).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
  })
})

describe('authenticatedOnly / denyAll', () => {
  it('authenticatedOnly is exactly !!user', async () => {
    const { invoke } = makePayload([])
    expect(await invoke(authenticatedOnly, { user: plainUser })).toBe(true)
    expect(await invoke(authenticatedOnly, { user: null })).toBe(false)
  })
  it('denyAll denies admins too', async () => {
    const { invoke } = makePayload([])
    expect(await invoke(denyAll, { user: adminUser })).toBe(false)
  })
})

describe('docWorkspaceMutate: tenant immutability through resolveWorkspace (review finding)', () => {
  const byId = {
    'dep-1': { id: 'dep-1', app: 'app-a' },
    'app-a': { id: 'app-a', workspace: 'ws-1' },
    'app-b': { id: 'app-b', workspace: 'ws-2' },
  }
  const resolveViaApp = async ({ doc, payload }: { doc: unknown; payload: Payload }) => {
    const appId = (doc as { app?: string }).app
    if (!appId) return null
    const app = (await payload.findByID({ collection: 'apps' as never, id: appId })) as { workspace?: string }
    return app.workspace ?? null
  }

  it('denies a member of ws-1 repointing a deployment at an app in ws-2', async () => {
    const { invoke } = makePayload([active('owner', 'ws-1')], {}, byId)
    const access = docWorkspaceMutate('deployments', ['owner', 'admin', 'member'], { field: 'app', resolveWorkspace: resolveViaApp })
    expect(await invoke(access, { user: plainUser, id: 'dep-1', data: { app: 'app-b' } })).toBe(false)
  })

  it('allows an update that keeps the parent inside the same workspace', async () => {
    const { invoke } = makePayload([active('owner', 'ws-1')], {}, { ...byId, 'app-c': { id: 'app-c', workspace: 'ws-1' } })
    const access = docWorkspaceMutate('deployments', ['owner', 'admin', 'member'], { field: 'app', resolveWorkspace: resolveViaApp })
    expect(await invoke(access, { user: plainUser, id: 'dep-1', data: { app: 'app-c' } })).toBe(true)
    expect(await invoke(access, { user: plainUser, id: 'dep-1', data: { title: 'x' } })).toBe(true)
  })

  it('the owner bypass does not let an author move a doc across tenants', async () => {
    const { invoke } = makePayload([], {}, { 'pg-1': { id: 'pg-1', knowledgeSpace: 'sp-1', author: 'payload-1' }, 'sp-1': { id: 'sp-1', workspace: 'ws-1' }, 'sp-2': { id: 'sp-2', workspace: 'ws-2' } })
    const resolveViaSpace = async ({ doc, payload }: { doc: unknown; payload: Payload }) => {
      const sp = (await payload.findByID({ collection: 'knowledge-spaces' as never, id: (doc as { knowledgeSpace: string }).knowledgeSpace })) as { workspace?: string }
      return sp.workspace ?? null
    }
    const access = docWorkspaceMutate('knowledge-pages', ['owner', 'admin'], { field: 'knowledgeSpace', resolveWorkspace: resolveViaSpace, ownerField: 'author' })
    expect(await invoke(access, { user: plainUser, id: 'pg-1', data: { knowledgeSpace: 'sp-2' } })).toBe(false)
    expect(await invoke(access, { user: plainUser, id: 'pg-1', data: { title: 'edit' } })).toBe(true)
  })
})

describe('workspaceScopedRead: no workspaces ⇒ NOTHING (review finding)', () => {
  it('direct-field read for a non-member returns the match-nothing filter, not in: []', async () => {
    const { invoke } = makePayload([])
    expect(await invoke(workspaceScopedRead(), { user: plainUser })).toEqual(NOTHING)
  })
  it('includeGlobal still exposes global rows to a non-member', async () => {
    const { invoke } = makePayload([])
    expect(await invoke(workspaceScopedRead({ includeGlobal: true }), { user: plainUser })).toEqual({ or: [NOTHING, { workspace: { exists: false } }] })
  })
})
