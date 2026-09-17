/**
 * @vitest-environment node
 *
 * Covers issue #69 item 3: PageLinks access, migrated onto the authz
 * adapters (workspaceScopedRead via two hops, memberCreate, denyAll,
 * docWorkspaceMutate) in docs/plans/2026-09-16-authz-consolidation.md §2.3.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload } from 'payload'
import { PageLinks } from '../PageLinks'

/* eslint-disable @typescript-eslint/no-explicit-any */
type MemberDoc = { workspace: string; user: string; role: string; status: string }
type Rows = Record<string, Array<Record<string, unknown>>>

function makePayload(members: MemberDoc[], rows: Rows = {}, byId: Record<string, unknown> = {}) {
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
  return { find, findByID, invoke }
}

const active = (role: string, workspace = 'ws-1', user = 'ba-1'): MemberDoc => ({ workspace, user, role, status: 'active' })
const plainUser = { id: 'payload-1', betterAuthId: 'ba-1', role: 'user', collection: 'users' }
const adminUser = { id: 'payload-9', betterAuthId: 'ba-9', role: 'admin', collection: 'users' }

// Chain: link.fromPage -> pg-1 -> knowledgeSpace sp-1 -> workspace ws-1
const rows: Rows = {
  'knowledge-spaces': [{ id: 'sp-1', workspace: 'ws-1' }],
  'knowledge-pages': [{ id: 'pg-1', knowledgeSpace: 'sp-1' }, { id: 'pg-2', knowledgeSpace: 'sp-other' }],
}
const byId = {
  'link-1': { id: 'link-1', fromPage: 'pg-1', toPage: 'pg-2' },
  'pg-1': { id: 'pg-1', knowledgeSpace: 'sp-1' },
  'sp-1': { id: 'sp-1', workspace: 'ws-1' },
}

describe('PageLinks access', () => {
  describe('read', () => {
    it('denies anonymous callers', async () => {
      const { invoke } = makePayload([], rows)
      expect(await invoke(PageLinks.access!.read as Access, { user: null })).toBe(false)
    })

    it('allows platform admin unrestricted read', async () => {
      const { invoke, find } = makePayload([], rows)
      expect(await invoke(PageLinks.access!.read as Access, { user: adminUser })).toBe(true)
      expect(find).not.toHaveBeenCalled()
    })

    it('a workspace member gets a filter that matches links via their space -> page chain', async () => {
      const { invoke } = makePayload([active('member')], rows)
      const where = await invoke(PageLinks.access!.read as Access, { user: plainUser })
      expect(where).toEqual({ fromPage: { in: ['pg-1'] } })
    })

    it('a non-member gets a match-nothing filter', async () => {
      const { invoke } = makePayload([], rows)
      const where = await invoke(PageLinks.access!.read as Access, { user: plainUser })
      expect(where).toEqual({ id: { equals: '__authz_no_match__' } })
    })
  })

  describe('create', () => {
    it('denies a non-member of the fromPage workspace', async () => {
      const { invoke } = makePayload([], rows, byId)
      const allowed = await invoke(PageLinks.access!.create as Access, {
        user: plainUser,
        data: { fromPage: 'pg-1', toPage: 'pg-2' },
      })
      expect(allowed).toBe(false)
    })

    it('allows a member of the fromPage workspace', async () => {
      const { invoke } = makePayload([active('member')], rows, byId)
      const allowed = await invoke(PageLinks.access!.create as Access, {
        user: plainUser,
        data: { fromPage: 'pg-1', toPage: 'pg-2' },
      })
      expect(allowed).toBe(true)
    })
  })

  describe('update', () => {
    it('denies everyone, including platform admins (links are immutable)', async () => {
      const { invoke } = makePayload([active('owner')], rows, byId)
      expect(await invoke(PageLinks.access!.update as Access, { user: plainUser, id: 'link-1' })).toBe(false)
      expect(await invoke(PageLinks.access!.update as Access, { user: adminUser, id: 'link-1' })).toBe(false)
    })
  })
})
