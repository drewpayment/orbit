/**
 * @vitest-environment node
 *
 * AgentToolVersions.access, post-migration to `workspaceScopedRead` with a
 * `via` join through agent-tools. Harness mirrors
 * `lib/authz/__tests__/payload.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'
import { AgentToolVersions } from '../AgentToolVersions'

type MemberDoc = { workspace: string; user: string; role: string; status: string }
type Rows = Record<string, Array<Record<string, unknown>>>

function makePayload(members: MemberDoc[], rows: Rows = {}) {
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
  const invoke = (ctx: { user?: unknown; data?: unknown; id?: unknown }) =>
    (AgentToolVersions.access!.read as any)({ req: { user: ctx.user, payload: { find } as unknown as Payload }, data: ctx.data, id: ctx.id })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { find, invoke }
}

const active = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({ workspace, user, role, status: 'active' })
const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const adminUser = { id: 'payload-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }

describe('AgentToolVersions.access.read', () => {
  it('denies anonymous callers', async () => {
    const { invoke } = makePayload([])
    expect(await invoke({ user: null })).toBe(false)
  })

  it('platform admin reads everything', async () => {
    const { invoke, find } = makePayload([])
    expect(await invoke({ user: adminUser })).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })

  it('member of ws-1 sees only versions whose tool belongs to ws-1', async () => {
    const { invoke } = makePayload([active('member')], {
      'agent-tools': [
        { id: 'tool-1', workspace: 'ws-1' },
        { id: 'tool-2', workspace: 'ws-9' },
      ],
    })
    const where = await invoke({ user: plainUser })
    expect(where).toEqual({ tool: { in: ['tool-1'] } })
  })

  it('a non-member gets a match-nothing filter without querying agent-tools', async () => {
    const { invoke, find } = makePayload([], { 'agent-tools': [{ id: 'tool-1', workspace: 'ws-1' }] })
    const where = await invoke({ user: plainUser })
    expect(where).toEqual({ id: { equals: '__authz_no_match__' } })
    expect(find.mock.calls.some((c) => c[0].collection === 'agent-tools')).toBe(false)
  })

  it('writes deny even for platform admins', async () => {
    const { invoke: _unused } = makePayload([])
    void _unused
    const create = AgentToolVersions.access!.create!
    const update = AgentToolVersions.access!.update!
    const del = AgentToolVersions.access!.delete!
    const ctx = { req: { user: adminUser, payload: {} as Payload } } as never
    expect(await create(ctx)).toBe(false)
    expect(await update(ctx)).toBe(false)
    expect(await del(ctx)).toBe(false)
  })
})
