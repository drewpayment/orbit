/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'
import { can, principalOf, defaultRoles, ALL_ROLES, MANAGE_ROLES } from '../policy'

type MemberDoc = { workspace: string; user: string; role: string; status: string }

function makePayload(members: MemberDoc[]) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const find = vi.fn(async (args: any) => {
    if (args.collection !== 'workspace-members') return { docs: [] }
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
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { payload: { find } as unknown as Payload, find }
}

const active = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({ workspace, user, role, status: 'active' })

// Payload id and Better-Auth id deliberately differ.
const member = { payloadId: 'p-1', betterAuthId: 'ba-1', isPlatformAdmin: false }
const admin = { payloadId: 'p-9', betterAuthId: 'ba-9', isPlatformAdmin: true }

describe('principalOf', () => {
  it('reads an Actor by its named ids', () => {
    expect(principalOf({ payloadId: 'p-1', betterAuthId: 'ba-1', isPlatformAdmin: false })).toEqual(member)
  })
  it('reads a Payload req.user: id → payloadId, betterAuthId → betterAuthId, role → isPlatformAdmin', () => {
    expect(principalOf({ id: 'p-1', betterAuthId: 'ba-1', role: 'user' })).toEqual(member)
    expect(principalOf({ id: 'p-9', betterAuthId: 'ba-9', role: 'admin' })?.isPlatformAdmin).toBe(true)
  })
  it('treats a missing betterAuthId as null, never as the Payload id', () => {
    expect(principalOf({ id: 'p-1', role: 'user' })).toEqual({ payloadId: 'p-1', betterAuthId: null, isPlatformAdmin: false })
  })
  it('returns null for anonymous', () => {
    expect(principalOf(null)).toBeNull()
    expect(principalOf(undefined)).toBeNull()
  })
})

describe('defaultRoles', () => {
  it('read/create need any role; update/delete/manage need owner or admin', () => {
    expect(defaultRoles('read')).toBe(ALL_ROLES)
    expect(defaultRoles('create')).toBe(ALL_ROLES)
    expect(defaultRoles('update')).toBe(MANAGE_ROLES)
    expect(defaultRoles('delete')).toBe(MANAGE_ROLES)
    expect(defaultRoles('manage')).toBe(MANAGE_ROLES)
  })
})

describe('can', () => {
  it('denies anonymous before anything else', async () => {
    const { payload, find } = makePayload([active('owner')])
    const d = await can(payload, null, 'read', { kind: 'workspace', id: 'ws-1' })
    expect(d.allowed).toBe(false)
    expect(find).not.toHaveBeenCalled()
  })

  it('platform admin is allowed everything without a membership query', async () => {
    const { payload, find } = makePayload([])
    expect((await can(payload, admin, 'delete', { kind: 'workspace', id: 'ws-1' })).allowed).toBe(true)
    expect((await can(payload, admin, 'read', { kind: 'platform' })).allowed).toBe(true)
    expect(find).not.toHaveBeenCalled()
  })

  it('platform resources deny non-admins', async () => {
    const { payload } = makePayload([active('owner')])
    expect((await can(payload, member, 'read', { kind: 'platform' })).allowed).toBe(false)
  })

  describe('workspace', () => {
    const matrix: Array<[string, 'read' | 'update' | 'delete', boolean]> = [
      ['member', 'read', true],
      ['member', 'update', false],
      ['admin', 'update', true],
      ['admin', 'delete', true],
      ['owner', 'delete', true],
    ]
    it.each(matrix)('%s doing %s → %s (default roles)', async (role, verb, expected) => {
      const { payload } = makePayload([active(role)])
      expect((await can(payload, member, verb, { kind: 'workspace', id: 'ws-1' })).allowed).toBe(expected)
    })

    it('explicit roles override the verb default', async () => {
      const { payload } = makePayload([active('admin')])
      expect((await can(payload, member, 'delete', { kind: 'workspace', id: 'ws-1', roles: ['owner'] })).allowed).toBe(false)
      expect((await can(payload, member, 'update', { kind: 'workspace', id: 'ws-1', roles: ['member'] })).allowed).toBe(false)
    })

    it('denies a non-member and a member of a different workspace', async () => {
      const { payload } = makePayload([active('owner', 'ws-2')])
      const d = await can(payload, member, 'read', { kind: 'workspace', id: 'ws-1' })
      expect(d.allowed).toBe(false)
      expect(d.reason).toMatch(/not a member/)
    })

    it('ignores inactive memberships', async () => {
      const { payload } = makePayload([{ workspace: 'ws-1', user: 'ba-1', role: 'owner', status: 'pending' }])
      expect((await can(payload, member, 'read', { kind: 'workspace', id: 'ws-1' })).allowed).toBe(false)
    })

    it('keys the membership query on betterAuthId, never payloadId', async () => {
      const { payload, find } = makePayload([active('owner', 'ws-1', 'p-1')]) // membership stored under the Payload id
      expect((await can(payload, member, 'read', { kind: 'workspace', id: 'ws-1' })).allowed).toBe(false)
      const and = find.mock.calls[0][0].where.and
      expect(and).toContainEqual({ user: { equals: 'ba-1' } })
    })

    it('a principal without a betterAuthId is a non-member, without querying', async () => {
      const { payload, find } = makePayload([active('owner')])
      const d = await can(payload, { ...member, betterAuthId: null }, 'read', { kind: 'workspace', id: 'ws-1' })
      expect(d.allowed).toBe(false)
      expect(find).not.toHaveBeenCalled()
    })

    it('a lookup failure is a deny, not a throw', async () => {
      const payload = { find: vi.fn(async () => { throw new Error('db down') }) } as unknown as Payload
      const d = await can(payload, member, 'read', { kind: 'workspace', id: 'ws-1' })
      expect(d.allowed).toBe(false)
    })
  })

  describe('doc', () => {
    it('owner of the doc (Payload id) is allowed regardless of workspace role', async () => {
      const { payload, find } = makePayload([])
      const d = await can(payload, member, 'update', { kind: 'doc', workspaceId: 'ws-1', ownerPayloadId: 'p-1' })
      expect(d.allowed).toBe(true)
      expect(find).not.toHaveBeenCalled()
    })

    it('ownership compares Payload ids, not Better-Auth ids', async () => {
      const { payload } = makePayload([])
      const d = await can(payload, member, 'update', { kind: 'doc', workspaceId: 'ws-1', ownerPayloadId: 'ba-1' })
      expect(d.allowed).toBe(false)
    })

    it('falls back to workspace role when not the owner', async () => {
      const { payload } = makePayload([active('admin')])
      expect((await can(payload, member, 'update', { kind: 'doc', workspaceId: 'ws-1', ownerPayloadId: 'p-other' })).allowed).toBe(true)
    })

    it('a doc with no workspace is admin-only unless owned', async () => {
      const { payload } = makePayload([active('owner')])
      expect((await can(payload, member, 'update', { kind: 'doc', workspaceId: null })).allowed).toBe(false)
      expect((await can(payload, member, 'update', { kind: 'doc', workspaceId: null, ownerPayloadId: 'p-1' })).allowed).toBe(true)
    })
  })
})
