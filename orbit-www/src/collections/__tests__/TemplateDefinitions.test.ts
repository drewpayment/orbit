/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import type { Access, Payload } from 'payload'
import { TemplateDefinitions } from '../TemplateDefinitions'

/* eslint-disable @typescript-eslint/no-explicit-any */
type MemberDoc = { workspace: string; user: string; role: string; status: string }

function makePayload(members: MemberDoc[], byId: Record<string, unknown> = {}) {
  const find = vi.fn(async (args: any) => {
    if (args.collection !== 'workspace-members') return { docs: [] }
    const and: any[] = args.where?.and ?? []
    const filtered = members.filter((m) =>
      and.every((cond) => {
        if (cond.workspace) return m.workspace === cond.workspace.equals
        if (cond.user) return m.user === cond.user.equals
        if (cond.status) return m.status === cond.status.equals
        if (cond.role?.equals) return m.role === cond.role.equals
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
  return { payload: { find, findByID } as unknown as Payload, find, findByID }
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
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('TemplateDefinitions collection shape', () => {
  it('is slugged template-definitions with the expected top-level fields', () => {
    expect(TemplateDefinitions.slug).toBe('template-definitions')
    const fieldNames = TemplateDefinitions.fields.map((f) => ('name' in f ? f.name : undefined))
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'name',
        'slug',
        'title',
        'description',
        'workspace',
        'owner',
        'targetKind',
        'visibility',
        'sharedWith',
        'status',
        'currentVersion',
        'sourceMode',
        'gitSource',
        'migratedFrom',
        'fixtures',
        'usageCount',
        'lastDryRunAt',
        'createdBy',
      ]),
    )
  })

  it('declares the slug/workspace/visibility indexes', () => {
    const indexes = TemplateDefinitions.indexes ?? []
    expect(indexes).toContainEqual({ fields: ['slug'], unique: true })
    expect(indexes).toContainEqual({ fields: ['workspace', 'status'] })
    expect(indexes).toContainEqual({ fields: ['workspace', 'visibility'] })
  })
})

describe('TemplateDefinitions.access.read', () => {
  it('denies anonymous callers', async () => {
    const { payload } = makePayload([])
    const result = await invoke(TemplateDefinitions.access!.read!, { user: undefined, payload })
    expect(result).toBe(false)
  })

  it('returns an or-filter across public / workspace / sharedWith, mirroring Templates.ts', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-1')])
    const result = await invoke(TemplateDefinitions.access!.read!, { user: plainUser, payload })
    expect(result).toEqual({
      or: [
        { visibility: { equals: 'public' } },
        { workspace: { in: ['ws-1'] } },
        { sharedWith: { in: ['ws-1'] } },
      ],
    })
  })
})

describe('TemplateDefinitions.access.create', () => {
  it('allows an active member of the target workspace', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-1')])
    const result = await invoke(TemplateDefinitions.access!.create!, {
      user: plainUser,
      payload,
      data: { workspace: 'ws-1' },
    })
    expect(result).toBe(true)
  })

  it('denies a non-member', async () => {
    const { payload } = makePayload([])
    const result = await invoke(TemplateDefinitions.access!.create!, {
      user: plainUser,
      payload,
      data: { workspace: 'ws-1' },
    })
    expect(result).toBe(false)
  })
})

describe('TemplateDefinitions.access.update / delete', () => {
  it('requires owner/admin role on the doc workspace', async () => {
    const { payload } = makePayload([member('admin', 'ws-1', 'ba-1')], {
      'def-1': { id: 'def-1', workspace: 'ws-1' },
    })
    const result = await invoke(TemplateDefinitions.access!.update!, {
      user: plainUser,
      payload,
      id: 'def-1',
    })
    expect(result).toBe(true)
  })

  it('denies a plain member', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-1')], {
      'def-1': { id: 'def-1', workspace: 'ws-1' },
    })
    const result = await invoke(TemplateDefinitions.access!.delete!, {
      user: plainUser,
      payload,
      id: 'def-1',
    })
    expect(result).toBe(false)
  })
})
