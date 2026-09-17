/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload } from 'payload'
import { Workspaces } from '../Workspaces'

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

const invoke = (
  access: Access,
  ctx: { user?: unknown; payload?: Payload; data?: unknown; id?: unknown },
) => access({ req: { user: ctx.user, payload: ctx.payload }, data: ctx.data, id: ctx.id } as any)

const member = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({
  workspace,
  user,
  role,
  status: 'active',
})

const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const adminUser = { id: 'payload-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('Workspaces access', () => {
  describe('read', () => {
    it('denies unauthenticated callers', async () => {
      const { payload } = makePayload([])
      expect(await invoke(Workspaces.access!.read!, { user: undefined, payload, id: 'ws-1' })).toBe(false)
    })

    it('allows ANY authenticated user to read a single workspace by id (join/invite flows)', async () => {
      const { payload } = makePayload([])
      expect(await invoke(Workspaces.access!.read!, { user: plainUser, payload, id: 'ws-1' })).toBe(true)
    })

    it('scopes list reads to workspaces the caller is a member of', async () => {
      const { payload } = makePayload([member('member', 'ws-1'), member('owner', 'ws-2', 'ba-1')])
      const where = await invoke(Workspaces.access!.read!, { user: plainUser, payload })
      expect(where).toEqual({ id: { in: ['ws-1', 'ws-2'] } })
    })

    it('platform admin reads everything, including list queries', async () => {
      const { payload } = makePayload([])
      expect(await invoke(Workspaces.access!.read!, { user: adminUser, payload })).toBe(true)
    })
  })

  describe('create', () => {
    it('allows any authenticated user', async () => {
      expect(await invoke(Workspaces.access!.create!, { user: plainUser })).toBe(true)
    })

    it('denies unauthenticated callers', async () => {
      expect(await invoke(Workspaces.access!.create!, { user: undefined })).toBe(false)
    })
  })

  describe('update', () => {
    it('limits the filter to workspaces the caller manages (owner/admin)', async () => {
      const { payload } = makePayload([member('admin', 'ws-1'), member('member', 'ws-2', 'ba-1')])
      const where = await invoke(Workspaces.access!.update!, { user: plainUser, payload })
      expect(where).toEqual({ id: { in: ['ws-1'] } })
    })

    it('platform admin can update any workspace', async () => {
      const { payload } = makePayload([])
      expect(await invoke(Workspaces.access!.update!, { user: adminUser, payload })).toBe(true)
    })
  })

  describe('delete', () => {
    it('limits the filter to workspaces the caller owns', async () => {
      const { payload } = makePayload([member('owner', 'ws-1'), member('admin', 'ws-2', 'ba-1')])
      const where = await invoke(Workspaces.access!.delete!, { user: plainUser, payload })
      expect(where).toEqual({ id: { in: ['ws-1'] } })
    })

    it('platform admin can delete any workspace', async () => {
      const { payload } = makePayload([])
      expect(await invoke(Workspaces.access!.delete!, { user: adminUser, payload })).toBe(true)
    })
  })
})
