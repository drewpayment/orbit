/**
 * @vitest-environment node
 *
 * CatalogEntities access, migrated off `lib/catalog/entity-authz` onto the
 * shared authz adapters (memberCreate, docWorkspaceMutate, authenticatedOnly)
 * in docs/plans/2026-09-16-authz-consolidation.md, Phase C (#135). Replaces the
 * former coverage in `lib/catalog/entity-authz.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload } from 'payload'
import { CatalogEntities } from '../catalog/CatalogEntities'

/* eslint-disable @typescript-eslint/no-explicit-any */
type MemberDoc = { workspace: string; user: string; role: string; status: string }

function makePayload(members: MemberDoc[], byId: Record<string, unknown> = {}) {
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
  const findByID = vi.fn(async (args: any) => {
    const doc = byId[args.id]
    if (!doc) throw new Error('not found')
    return doc
  })
  const invoke = (access: Access, ctx: { user?: unknown; data?: unknown; id?: unknown }) =>
    access({
      req: { user: ctx.user, payload: { find, findByID } as unknown as Payload },
      data: ctx.data,
      id: ctx.id,
    } as any)
  return { find, findByID, invoke }
}

const active = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({
  workspace,
  user,
  role,
  status: 'active',
})
const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const adminUser = { id: 'payload-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }

const byId = {
  'e-manual': { id: 'e-manual', workspace: 'ws-1', source: { type: 'manual' } },
  'e-global-manual': { id: 'e-global-manual', workspace: null, source: { type: 'manual' } },
  'e-projected': { id: 'e-projected', workspace: 'ws-1', source: { type: 'apps' } },
}

describe('CatalogEntities access', () => {
  describe('read', () => {
    it('denies anonymous callers', async () => {
      const { invoke } = makePayload([])
      expect(await invoke(CatalogEntities.access!.read as Access, { user: null })).toBe(false)
    })

    it('allows any authenticated user (org-wide discovery surface)', async () => {
      const { invoke } = makePayload([])
      expect(await invoke(CatalogEntities.access!.read as Access, { user: plainUser })).toBe(true)
    })
  })

  describe('create', () => {
    it('allows an active member (any role) creating into their workspace', async () => {
      const { invoke } = makePayload([active('member')])
      const allowed = await invoke(CatalogEntities.access!.create as Access, {
        user: plainUser,
        data: { workspace: 'ws-1' },
      })
      expect(allowed).toBe(true)
    })

    it('denies a non-member', async () => {
      const { invoke } = makePayload([active('member', 'ws-2')])
      const allowed = await invoke(CatalogEntities.access!.create as Access, {
        user: plainUser,
        data: { workspace: 'ws-1' },
      })
      expect(allowed).toBe(false)
    })

    it('denies a non-admin creating a global (workspace-less) entity', async () => {
      const { invoke } = makePayload([active('owner')])
      const allowed = await invoke(CatalogEntities.access!.create as Access, {
        user: plainUser,
        data: {},
      })
      expect(allowed).toBe(false)
    })

    it('allows a platform admin to create anywhere, including global', async () => {
      const { invoke } = makePayload([])
      expect(
        await invoke(CatalogEntities.access!.create as Access, { user: adminUser, data: { workspace: 'ws-1' } }),
      ).toBe(true)
      expect(await invoke(CatalogEntities.access!.create as Access, { user: adminUser, data: {} })).toBe(true)
    })
  })

  describe('update', () => {
    it('allows an active member (any role) to edit an entity in their workspace', async () => {
      const { invoke } = makePayload([active('member')], byId)
      expect(
        await invoke(CatalogEntities.access!.update as Access, { user: plainUser, id: 'e-manual' }),
      ).toBe(true)
    })

    it('denies a non-member', async () => {
      const { invoke } = makePayload([], byId)
      expect(
        await invoke(CatalogEntities.access!.update as Access, { user: plainUser, id: 'e-manual' }),
      ).toBe(false)
    })

    it('denies a non-admin editing a global entity', async () => {
      const { invoke } = makePayload([active('owner')], byId)
      expect(
        await invoke(CatalogEntities.access!.update as Access, { user: plainUser, id: 'e-global-manual' }),
      ).toBe(false)
    })
  })

  describe('delete', () => {
    it('denies a projected entity even for a platform admin (guard runs before admin bypass)', async () => {
      const { invoke } = makePayload([], byId)
      expect(
        await invoke(CatalogEntities.access!.delete as Access, { user: adminUser, id: 'e-projected' }),
      ).toBe(false)
    })

    it('allows a workspace owner/admin to delete a manual entity', async () => {
      const { invoke } = makePayload([active('admin')], byId)
      expect(
        await invoke(CatalogEntities.access!.delete as Access, { user: plainUser, id: 'e-manual' }),
      ).toBe(true)
    })

    it('denies a plain member deleting a manual entity (delete needs owner/admin)', async () => {
      const { invoke } = makePayload([active('member')], byId)
      expect(
        await invoke(CatalogEntities.access!.delete as Access, { user: plainUser, id: 'e-manual' }),
      ).toBe(false)
    })

    it('allows a platform admin to delete a manual global entity', async () => {
      const { invoke } = makePayload([], byId)
      expect(
        await invoke(CatalogEntities.access!.delete as Access, { user: adminUser, id: 'e-global-manual' }),
      ).toBe(true)
    })
  })
})
