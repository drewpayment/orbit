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

/**
 * Minimal Mongo-query-semantics evaluator for the `equals` / `in` / `not_equals`
 * operators our access filters use, under `and`/`or` combinators — lets the read
 * tests assert actual per-document visibility rather than the raw filter shape,
 * which is what the design doc's visibility rules (§3.2) are really about.
 */
type WhereClause = Record<string, unknown>
function matchesWhere(doc: Record<string, unknown>, where: WhereClause): boolean {
  if ('and' in where) return (where.and as WhereClause[]).every((c) => matchesWhere(doc, c))
  if ('or' in where) return (where.or as WhereClause[]).some((c) => matchesWhere(doc, c))
  const [field, op] = Object.entries(where)[0] as [string, Record<string, unknown>]
  const value = doc[field]
  if ('equals' in op) return value === op.equals
  if ('not_equals' in op) return value !== op.not_equals
  if ('in' in op) return Array.isArray(op.in) && (op.in as unknown[]).includes(value)
  throw new Error(`Unsupported operator in test evaluator: ${JSON.stringify(op)}`)
}

describe('TemplateDefinitions.access.read', () => {
  it('denies anonymous callers', async () => {
    const { payload } = makePayload([])
    const result = await invoke(TemplateDefinitions.access!.read!, { user: undefined, payload })
    expect(result).toBe(false)
  })

  it('a plain workspace member sees published rows only (not other authors\' drafts)', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-1')])
    const where = (await invoke(TemplateDefinitions.access!.read!, {
      user: plainUser,
      payload,
    })) as WhereClause

    const otherAuthorsDraft = { status: 'draft', visibility: 'workspace', workspace: 'ws-1', createdBy: 'payload-OTHER' }
    const publishedInWorkspace = { status: 'published', visibility: 'workspace', workspace: 'ws-1', createdBy: 'payload-OTHER' }
    expect(matchesWhere(otherAuthorsDraft, where)).toBe(false)
    expect(matchesWhere(publishedInWorkspace, where)).toBe(true)
  })

  it('the author sees their own draft', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-1')])
    const where = (await invoke(TemplateDefinitions.access!.read!, {
      user: plainUser,
      payload,
    })) as WhereClause

    const ownDraft = { status: 'draft', visibility: 'workspace', workspace: 'ws-1', createdBy: 'payload-1' }
    expect(matchesWhere(ownDraft, where)).toBe(true)
  })

  it('a workspace owner/admin sees every draft in that workspace, not just their own', async () => {
    const { payload } = makePayload([member('admin', 'ws-1', 'ba-1')])
    const where = (await invoke(TemplateDefinitions.access!.read!, {
      user: plainUser,
      payload,
    })) as WhereClause

    const someonesDraft = { status: 'draft', visibility: 'workspace', workspace: 'ws-1', createdBy: 'payload-OTHER' }
    expect(matchesWhere(someonesDraft, where)).toBe(true)
  })

  it('a public draft is not visible to an outsider (visibility does not override draft status)', async () => {
    const { payload } = makePayload([member('member', 'ws-2', 'ba-1')]) // not a member of ws-1
    const where = (await invoke(TemplateDefinitions.access!.read!, {
      user: plainUser,
      payload,
    })) as WhereClause

    const publicDraft = { status: 'draft', visibility: 'public', workspace: 'ws-1', createdBy: 'payload-OTHER' }
    expect(matchesWhere(publicDraft, where)).toBe(false)
  })

  it('still allows a published public row to any authenticated user (parity with Templates.ts)', async () => {
    const { payload } = makePayload([member('member', 'ws-2', 'ba-1')])
    const where = (await invoke(TemplateDefinitions.access!.read!, {
      user: plainUser,
      payload,
    })) as WhereClause

    const publishedPublic = { status: 'published', visibility: 'public', workspace: 'ws-1', createdBy: 'payload-OTHER' }
    expect(matchesWhere(publishedPublic, where)).toBe(true)
  })
})

describe('TemplateDefinitions.access.create', () => {
  it('allows a workspace owner/admin of the target workspace (design §3.7)', async () => {
    const { payload } = makePayload([member('admin', 'ws-1', 'ba-1')])
    const result = await invoke(TemplateDefinitions.access!.create!, {
      user: plainUser,
      payload,
      data: { workspace: 'ws-1' },
    })
    expect(result).toBe(true)
  })

  it('denies a plain member (must be owner/admin, not just an active member)', async () => {
    const { payload } = makePayload([member('member', 'ws-1', 'ba-1')])
    const result = await invoke(TemplateDefinitions.access!.create!, {
      user: plainUser,
      payload,
      data: { workspace: 'ws-1' },
    })
    expect(result).toBe(false)
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

describe('TemplateDefinitions platform-admin gate for shared/public + published (beforeChange hook)', () => {
  const beforeChangeHook = TemplateDefinitions.hooks!.beforeChange![0]
  const superAdmin = { id: 'payload-9', betterAuthId: 'ba-9', role: 'super_admin', collection: 'users' }

  // The hook is synchronous (throws directly rather than rejecting); normalize to a
  // Promise so every case can be asserted uniformly with .resolves/.rejects.
  const runHook = (args: {
    data: Record<string, unknown>
    originalDoc?: Record<string, unknown>
    user?: unknown
    context?: Record<string, unknown>
  }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (beforeChangeHook as any)({
        data: args.data,
        originalDoc: args.originalDoc,
        operation: 'update',
        req: { user: args.user, context: args.context ?? {} },
      })
      return Promise.resolve(result)
    } catch (err) {
      return Promise.reject(err)
    }
  }

  it('allows a platform admin to publish a shared-visibility definition', async () => {
    await expect(
      runHook({ data: { visibility: 'shared', status: 'published' }, user: superAdmin }),
    ).resolves.toBeDefined()
  })

  it('allows a platform admin to publish a public-visibility definition', async () => {
    await expect(
      runHook({ data: { visibility: 'public', status: 'published' }, user: superAdmin }),
    ).resolves.toBeDefined()
  })

  it('rejects a non-platform-admin user publishing a shared-visibility definition', async () => {
    await expect(
      runHook({ data: { visibility: 'shared', status: 'published' }, user: plainUser }),
    ).rejects.toThrow(/platform admin/i)
  })

  it('rejects a non-platform-admin user publishing a public-visibility definition', async () => {
    await expect(
      runHook({ data: { visibility: 'public', status: 'published' }, user: plainUser }),
    ).rejects.toThrow(/platform admin/i)
  })

  it('rejects when req.user is absent and no explicit context flag is passed (no silent overrideAccess bypass)', async () => {
    await expect(
      runHook({ data: { visibility: 'public', status: 'published' }, user: undefined }),
    ).rejects.toThrow(/platform admin/i)
  })

  it('allows when req.user is absent AND the explicit context flag is passed (authorized internal script)', async () => {
    await expect(
      runHook({
        data: { visibility: 'public', status: 'published' },
        user: undefined,
        context: { allowSharedPublicPublish: true },
      }),
    ).resolves.toBeDefined()
  })

  it('does not gate a workspace-visibility publish (only shared/public are restricted)', async () => {
    await expect(
      runHook({ data: { visibility: 'workspace', status: 'published' }, user: plainUser }),
    ).resolves.toBeDefined()
  })

  it('does not gate a draft with shared/public visibility (only published status is restricted)', async () => {
    await expect(
      runHook({ data: { visibility: 'public', status: 'draft' }, user: plainUser }),
    ).resolves.toBeDefined()
  })

  it('checks the resulting visibility/status by merging data over originalDoc (keeping already-shared visibility while publishing)', async () => {
    await expect(
      runHook({
        data: { status: 'published' },
        originalDoc: { visibility: 'shared' },
        user: plainUser,
      }),
    ).rejects.toThrow(/platform admin/i)
  })
})
