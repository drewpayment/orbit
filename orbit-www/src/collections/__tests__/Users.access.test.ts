/**
 * @vitest-environment node
 *
 * Access control for the `users` and `media` collections. Before this, Users
 * only defined `access.admin`, so Payload's default (any authenticated user)
 * applied to create/read/update/delete and to the `role` field: any logged-in
 * user could PATCH /api/users/<self> {role:'super_admin'}.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Field, FieldAccess, Payload } from 'payload'

vi.mock('../hooks/userApprovalHook', () => ({ userApprovalAfterChangeHook: vi.fn() }))
vi.mock('@/lib/payload-better-auth-strategy', () => ({ betterAuthStrategy: { name: 'better-auth', authenticate: vi.fn() } }))

import { Users } from '../Users'
import { Media } from '../Media'

/* eslint-disable @typescript-eslint/no-explicit-any */
type MemberDoc = { workspace: string; user: string; role: string; status: string }

function makePayload(opts: { members?: MemberDoc[]; users?: Record<string, any> } = {}) {
  const members = opts.members ?? []
  const users = opts.users ?? {}
  const find = vi.fn(async (args: any) => {
    if (args.collection !== 'workspace-members') return { docs: [] }
    const and: any[] = args.where?.and ?? []
    return {
      docs: members.filter((m) =>
        and.every((c) => {
          if (c.workspace?.equals) return m.workspace === c.workspace.equals
          if (c.workspace?.in) return c.workspace.in.includes(m.workspace)
          if (c.user) return m.user === c.user.equals
          if (c.status) return m.status === c.status.equals
          if (c.role?.in) return c.role.in.includes(m.role)
          return true
        }),
      ),
    }
  })
  const findByID = vi.fn(async (args: any) => {
    const doc = users[args.id]
    if (!doc) throw new Error('not found')
    return doc
  })
  return { payload: { find, findByID } as unknown as Payload, find, findByID }
}

const invoke = (access: Access, ctx: { user?: unknown; payload?: Payload; data?: unknown; id?: unknown }) =>
  access({ req: { user: ctx.user, payload: ctx.payload }, data: ctx.data, id: ctx.id } as any)

const field = (name: string): Field & { access?: { create?: FieldAccess; read?: FieldAccess; update?: FieldAccess } } =>
  Users.fields.find((f) => 'name' in f && f.name === name) as any

const invokeField = (
  access: FieldAccess | undefined,
  ctx: { user?: unknown; id?: string; doc?: unknown; data?: unknown; siblingData?: unknown },
) => access!({ req: { user: ctx.user }, id: ctx.id, doc: ctx.doc, data: ctx.data, siblingData: ctx.siblingData } as any)

const plain = { id: 'p-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const other = { id: 'p-2', betterAuthId: 'ba-2', role: 'user' }
const admin = { id: 'p-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }
const superAdmin = { id: 'p-0', betterAuthId: 'ba-0', role: 'super_admin', collection: 'users' }

const PRIVILEGED = ['role', 'status', 'betterAuthId', 'skipEmailVerification', 'invitedAt', 'registrationApprovedAt', 'registrationApprovedBy']

describe('Users access: privilege escalation', () => {
  it.each(PRIVILEGED)('a plain user cannot write %s on their own doc', async (name) => {
    const f = field(name)
    expect(f.access?.update, `${name} must declare field update access`).toBeDefined()
    expect(await invokeField(f.access!.update, { user: plain, id: 'p-1', doc: plain, data: { [name]: 'super_admin' }, siblingData: { [name]: 'super_admin' } })).toBe(false)
  })

  it.each(PRIVILEGED)('a plain user cannot set %s on create', async (name) => {
    const f = field(name)
    expect(f.access?.create, `${name} must declare field create access`).toBeDefined()
    expect(await invokeField(f.access!.create, { user: plain, siblingData: { [name]: 'x' } })).toBe(false)
  })

  it('an admin cannot promote themselves or another admin', async () => {
    const f = field('role')
    expect(await invokeField(f.access!.update, { user: admin, id: 'p-9', doc: admin, siblingData: { role: 'super_admin' } })).toBe(false)
    expect(await invokeField(f.access!.update, { user: admin, id: 'p-5', doc: { ...other, id: 'p-5' }, siblingData: { role: 'admin' } })).toBe(false)
    expect(await invokeField(f.access!.update, { user: admin, id: 'p-5', doc: { ...other, id: 'p-5', role: 'admin' }, siblingData: { role: 'user' } })).toBe(false)
  })

  it('an admin may only assign role user to a regular user (policy.canAssignRole)', async () => {
    const f = field('role')
    expect(await invokeField(f.access!.update, { user: admin, id: 'p-2', doc: other, siblingData: { role: 'user' } })).toBe(true)
    expect(await invokeField(f.access!.create, { user: admin, siblingData: { role: 'admin' } })).toBe(false)
    expect(await invokeField(f.access!.create, { user: admin, siblingData: { role: 'user' } })).toBe(true)
  })

  it('a super_admin may grant any role', async () => {
    const f = field('role')
    expect(await invokeField(f.access!.update, { user: superAdmin, id: 'p-2', doc: other, siblingData: { role: 'super_admin' } })).toBe(true)
    expect(await invokeField(f.access!.create, { user: superAdmin, siblingData: { role: 'admin' } })).toBe(true)
  })

  it('unauthenticated callers cannot write privileged fields', async () => {
    for (const name of PRIVILEGED) {
      expect(await invokeField(field(name).access!.update, { user: undefined, id: 'p-1', doc: plain })).toBe(false)
    }
  })
})

describe('Users access: field reads', () => {
  const sensitive = ['role', 'status', 'skipEmailVerification', 'invitedAt', 'registrationApprovedAt', 'registrationApprovedBy']
  it.each(sensitive)('%s is readable by self and admins, not by other users', async (name) => {
    const read = field(name).access?.read
    expect(read, `${name} must declare field read access`).toBeDefined()
    expect(await invokeField(read, { user: plain, id: 'p-1', doc: plain })).toBe(true)
    expect(await invokeField(read, { user: plain, id: 'p-2', doc: other })).toBe(false)
    expect(await invokeField(read, { user: admin, id: 'p-2', doc: other })).toBe(true)
    expect(await invokeField(read, { user: undefined, id: 'p-2', doc: other })).toBe(false)
  })
})

describe('Users access: collection level', () => {
  it('create: platform admins only', async () => {
    const { payload } = makePayload()
    const create = Users.access!.create!
    expect(await invoke(create, { user: plain, payload })).toBe(false)
    expect(await invoke(create, { user: undefined, payload })).toBe(false)
    expect(await invoke(create, { user: admin, payload })).toBe(true)
    expect(await invoke(create, { user: superAdmin, payload })).toBe(true)
  })

  it('delete: super_admin only', async () => {
    const { payload } = makePayload()
    const del = Users.access!.delete!
    expect(await invoke(del, { user: plain, payload, id: 'p-2' })).toBe(false)
    expect(await invoke(del, { user: admin, payload, id: 'p-2' })).toBe(false)
    expect(await invoke(del, { user: undefined, payload, id: 'p-2' })).toBe(false)
    expect(await invoke(del, { user: superAdmin, payload, id: 'p-2' })).toBe(true)
  })

  describe('update', () => {
    const users = { 'p-1': plain, 'p-2': other, 'p-9': admin, 'p-5': { id: 'p-5', role: 'admin' }, 'p-0': superAdmin }
    const update = Users.access!.update!

    it('a plain user can update only their own doc', async () => {
      const { payload } = makePayload({ users })
      expect(await invoke(update, { user: plain, payload, id: 'p-1' })).toBe(true)
      expect(await invoke(update, { user: plain, payload, id: 'p-2' })).toBe(false)
      expect(await invoke(update, { user: undefined, payload, id: 'p-1' })).toBe(false)
    })

    it('an admin can update themselves and regular users, not other admins or super_admins', async () => {
      const { payload } = makePayload({ users })
      expect(await invoke(update, { user: admin, payload, id: 'p-9' })).toBe(true)
      expect(await invoke(update, { user: admin, payload, id: 'p-2' })).toBe(true)
      expect(await invoke(update, { user: admin, payload, id: 'p-5' })).toBe(false)
      expect(await invoke(update, { user: admin, payload, id: 'p-0' })).toBe(false)
    })

    it('an admin update of a missing target is denied', async () => {
      const { payload } = makePayload({ users })
      expect(await invoke(update, { user: admin, payload, id: 'nope' })).toBe(false)
    })

    it('a super_admin can update anyone', async () => {
      const { payload } = makePayload({ users })
      expect(await invoke(update, { user: superAdmin, payload, id: 'p-5' })).toBe(true)
    })
  })

  describe('read', () => {
    const read = Users.access!.read!

    it('denies unauthenticated callers', async () => {
      const { payload } = makePayload()
      expect(await invoke(read, { user: undefined, payload })).toBe(false)
    })

    it('platform admins read everyone', async () => {
      const { payload } = makePayload()
      expect(await invoke(read, { user: admin, payload })).toBe(true)
      expect(await invoke(read, { user: superAdmin, payload })).toBe(true)
    })

    it('a user with no workspaces reads only themselves', async () => {
      const { payload } = makePayload()
      expect(await invoke(read, { user: plain, payload })).toEqual({ id: { equals: 'p-1' } })
    })

    it('a user reads themselves plus co-members of their workspaces, never other tenants', async () => {
      const { payload } = makePayload({
        members: [
          { workspace: 'ws-1', user: 'ba-1', role: 'member', status: 'active' },
          { workspace: 'ws-1', user: 'ba-2', role: 'owner', status: 'active' },
          { workspace: 'ws-2', user: 'ba-3', role: 'member', status: 'active' },
        ],
      })
      const where: any = await invoke(read, { user: plain, payload })
      expect(where.or).toContainEqual({ id: { equals: 'p-1' } })
      const inClause = where.or.find((c: any) => c.betterAuthId)
      expect([...inClause.betterAuthId.in].sort()).toEqual(['ba-1', 'ba-2'])
    })
  })
})

describe('Media access', () => {
  it('requires authentication to read (no app surface serves media anonymously)', async () => {
    expect(await invoke(Media.access!.read!, { user: undefined })).toBe(false)
    expect(await invoke(Media.access!.read!, { user: plain })).toBe(true)
  })

  it.each(['create', 'update', 'delete'] as const)('%s is platform-admin only', async (op) => {
    const access = Media.access![op]!
    expect(await invoke(access, { user: undefined, id: 'm-1' })).toBe(false)
    expect(await invoke(access, { user: plain, id: 'm-1' })).toBe(false)
    expect(await invoke(access, { user: admin, id: 'm-1' })).toBe(true)
  })
})
