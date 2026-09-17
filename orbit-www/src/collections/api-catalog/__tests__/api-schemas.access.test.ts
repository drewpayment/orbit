/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload } from 'payload'
import { APISchemas } from '../APISchemas'

/* eslint-disable @typescript-eslint/no-explicit-any */
type MemberDoc = { workspace: string; user: string; role: string; status: string }

function makePayload(members: MemberDoc[]) {
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
  return { payload: { find } as unknown as Payload, find }
}

const invoke = (access: Access, ctx: { user?: unknown; payload?: Payload }) =>
  access({ req: { user: ctx.user, payload: ctx.payload } } as any)

const member = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({
  workspace,
  user,
  role,
  status: 'active',
})

// The Better-Auth id and the Payload id are deliberately different here so a
// regression that compares the wrong one shows up as a failing assertion.
const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const adminUser = { id: 'payload-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('APISchemas access: read', () => {
  it('anonymous callers see only public schemas', async () => {
    const { payload } = makePayload([])
    const where = await invoke(APISchemas.access!.read!, { user: undefined, payload })
    expect(where).toEqual({ visibility: { equals: 'public' } })
  })

  it('platform admin sees everything', async () => {
    const { payload } = makePayload([])
    expect(await invoke(APISchemas.access!.read!, { user: adminUser, payload })).toBe(true)
  })

  it('a member sees public OR (workspace-visible AND in their workspaces) OR (private AND created by their Payload id)', async () => {
    const { payload } = makePayload([member('member', 'ws-1')])
    const where = await invoke(APISchemas.access!.read!, { user: plainUser, payload })
    expect(where).toEqual({
      or: [
        { visibility: { equals: 'public' } },
        { and: [{ visibility: { equals: 'workspace' } }, { workspace: { in: ['ws-1'] } }] },
        { and: [{ visibility: { equals: 'private' } }, { createdBy: { equals: 'payload-1' } }] },
      ],
    })
  })

  it('compares private ownership against the Payload id, never the Better-Auth id', async () => {
    const { payload } = makePayload([])
    const where = await invoke(APISchemas.access!.read!, { user: plainUser, payload })
    const privateBranch = (where as any).or.find((b: any) => b.and?.[0]?.visibility?.equals === 'private')
    expect(privateBranch.and[1]).toEqual({ createdBy: { equals: plainUser.id } })
    expect(privateBranch.and[1]).not.toEqual({ createdBy: { equals: plainUser.betterAuthId } })
  })

  it('a non-member gets an empty workspace-ids branch, not a crash', async () => {
    const { payload } = makePayload([])
    const where = await invoke(APISchemas.access!.read!, { user: plainUser, payload })
    expect(where).toEqual({
      or: [
        { visibility: { equals: 'public' } },
        { and: [{ visibility: { equals: 'workspace' } }, { workspace: { in: [] } }] },
        { and: [{ visibility: { equals: 'private' } }, { createdBy: { equals: 'payload-1' } }] },
      ],
    })
  })
})

describe('APISchemas access: update / delete via createdBy (Payload id)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const schemas: Record<string, any> = {
    mine: { id: 'mine', workspace: 'ws-1', createdBy: 'payload-1' },
    theirs: { id: 'theirs', workspace: 'ws-1', createdBy: { id: 'payload-2' } },
    // createdBy holding the caller's Better-Auth id must NOT count as ownership
    baOwned: { id: 'baOwned', workspace: 'ws-1', createdBy: 'ba-1' },
  }
  const withDocs = (members: MemberDoc[]) => {
    const { payload, find } = makePayload(members)
    ;(payload as any).findByID = vi.fn(async ({ id }: any) => {
      if (!schemas[id]) throw new Error('not found')
      return schemas[id]
    })
    return payload
  }
  const mutate = (access: Access, user: unknown, payload: Payload, id: string) =>
    access({ req: { user, payload }, id } as any)
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it('the creator can update and delete even without a workspace role', async () => {
    const payload = withDocs([])
    expect(await mutate(APISchemas.access!.update!, plainUser, payload, 'mine')).toBe(true)
    expect(await mutate(APISchemas.access!.delete!, plainUser, payload, 'mine')).toBe(true)
  })

  it('a Better-Auth id in createdBy is not ownership', async () => {
    const payload = withDocs([])
    expect(await mutate(APISchemas.access!.update!, plainUser, payload, 'baOwned')).toBe(false)
    expect(await mutate(APISchemas.access!.delete!, plainUser, payload, 'baOwned')).toBe(false)
  })

  it("someone else's schema: any active member may update, only owner/admin may delete", async () => {
    const asMember = withDocs([member('member', 'ws-1')])
    expect(await mutate(APISchemas.access!.update!, plainUser, asMember, 'theirs')).toBe(true)
    expect(await mutate(APISchemas.access!.delete!, plainUser, asMember, 'theirs')).toBe(false)
    const asAdmin = withDocs([member('admin', 'ws-1')])
    expect(await mutate(APISchemas.access!.delete!, plainUser, asAdmin, 'theirs')).toBe(true)
  })

  it('a non-member cannot touch another workspace’s schema; platform admin can', async () => {
    const payload = withDocs([member('owner', 'ws-other')])
    expect(await mutate(APISchemas.access!.update!, plainUser, payload, 'theirs')).toBe(false)
    expect(await mutate(APISchemas.access!.update!, adminUser, payload, 'theirs')).toBe(true)
  })
})
