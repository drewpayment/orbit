import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

/**
 * Tests for `editor-actions.ts` — the list-scoping helpers behind the template
 * catalog page and, more importantly, the two SOLE writers of the publish
 * gate's inputs (`markVersionValidated` → `validatedAt`,
 * `recordSuccessfulDryRun` → `dryRunRunId`).
 *
 * The gate writers get the most attention here: they are the only path by
 * which a client can influence whether a version becomes publishable, so each
 * one is probed with crafted ids to confirm it re-derives every fact from
 * persisted data instead of trusting the caller.
 */

const WORKSPACE_ID = 'ws-1'
const OTHER_WORKSPACE_ID = 'ws-2'

/** Minimal in-memory Payload fake covering the where-clause shapes this module uses. */
function makeFakePayload(seed?: Record<string, Record<string, unknown>[]>) {
  const store = new Map<string, Map<string, Record<string, unknown>>>()
  /** workspaceId → the caller's role there; absent means not a member. */
  let roles = new Map<string, string>([[WORKSPACE_ID, 'owner']])

  const col = (name: string) => {
    let m = store.get(name)
    if (!m) {
      m = new Map()
      store.set(name, m)
    }
    return m
  }
  for (const [name, docs] of Object.entries(seed ?? {})) {
    for (const doc of docs) col(name).set(String(doc.id), { ...doc })
  }

  function getPath(doc: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
      return undefined
    }, doc)
  }

  function matches(doc: Record<string, unknown>, clause: Record<string, unknown>): boolean {
    return Object.entries(clause).every(([field, cond]) => {
      if (field === 'and') return (cond as Record<string, unknown>[]).every((c) => matches(doc, c))
      if (field === 'or') return (cond as Record<string, unknown>[]).some((c) => matches(doc, c))
      const value = getPath(doc, field)
      const c = cond as Record<string, unknown>
      if ('equals' in c) return String(value) === String(c.equals)
      if ('not_equals' in c) return String(value) !== String(c.not_equals)
      if ('in' in c) return (c.in as unknown[]).map(String).includes(String(value))
      return true
    })
  }

  const find = vi.fn(async ({ collection, where, sort, limit }: Record<string, unknown>) => {
    if (collection === 'workspace-members') {
      const docs = [...roles.entries()].map(([ws, role], i) => ({
        id: `m-${i}`,
        role,
        status: 'active',
        workspace: ws,
        user: 'user-1',
      }))
      const filtered = where
        ? docs.filter((d) => matches(d, where as Record<string, unknown>))
        : docs
      return { docs: filtered }
    }
    let docs = [...col(collection as string).values()]
    if (where && Object.keys(where).length > 0) {
      docs = docs.filter((d) => matches(d, where as Record<string, unknown>))
    }
    if (typeof sort === 'string' && sort.startsWith('-')) {
      const field = sort.slice(1)
      docs = [...docs].sort((a, b) => Number(b[field] ?? 0) - Number(a[field] ?? 0))
    }
    if (typeof limit === 'number') docs = docs.slice(0, limit)
    return { docs }
  })

  const findByID = vi.fn(async ({ collection, id }: Record<string, unknown>) => {
    const doc = col(collection as string).get(String(id))
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return { ...doc }
  })

  const update = vi.fn(async ({ collection, id, data }: Record<string, unknown>) => {
    const existing = col(collection as string).get(String(id)) ?? { id }
    const merged = { ...existing, ...(data as Record<string, unknown>) }
    col(collection as string).set(String(id), merged)
    return { ...merged }
  })

  const create = vi.fn(async ({ collection, data }: Record<string, unknown>) => {
    const id = `${collection as string}-new`
    const doc = { id, ...(data as Record<string, unknown>) }
    col(collection as string).set(id, doc)
    return { ...doc }
  })

  return {
    payload: { find, findByID, update, create } as unknown as Payload,
    update,
    col,
    setRoles: (next: Map<string, string>) => {
      roles = next
    },
  }
}

let fake: ReturnType<typeof makeFakePayload>
let mockSessionUser: { id: string } | null = { id: 'user-1' }
let mockPayloadUser: { id: string; role?: string } | null = { id: 'pu-1', role: 'member' }
const mockValidate = vi.fn()

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => fake.payload) }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => mockSessionUser),
  getPayloadUserFromSession: vi.fn(async () => mockPayloadUser),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./authoring-actions', () => ({
  validateTemplateDefinition: (...args: unknown[]) => mockValidate(...args),
}))

const DEFINITION = {
  id: 'def-1',
  name: 'go-service',
  slug: 'go-service',
  title: 'Go service',
  description: null,
  workspace: WORKSPACE_ID,
  status: 'draft',
  visibility: 'workspace',
  sourceMode: 'orbit',
  createdBy: 'user-1',
  currentVersion: 'ver-1',
  fixtures: [],
  usageCount: 0,
  updatedAt: '2026-09-09T00:00:00.000Z',
}

const VERSION = {
  id: 'ver-1',
  definition: 'def-1',
  workspace: WORKSPACE_ID,
  versionNumber: 1,
  definitionJson: { apiVersion: 'orbit/v2', kind: 'Template' },
  validatedAt: null,
  dryRunRunId: null,
  createdAt: '2026-09-09T00:00:00.000Z',
}

const SUCCEEDED_DRY_RUN = {
  id: 'run-1',
  dryRun: true,
  status: 'succeeded',
  templateVersion: 'ver-1',
  workspace: WORKSPACE_ID,
}

function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  fake = makeFakePayload({
    workspaces: [
      { id: WORKSPACE_ID, name: 'Platform' },
      { id: OTHER_WORKSPACE_ID, name: 'Other' },
    ],
    'template-definitions': [DEFINITION],
    'template-definition-versions': [VERSION],
    'action-runs': [SUCCEEDED_DRY_RUN],
    ...extra,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSessionUser = { id: 'user-1' }
  mockPayloadUser = { id: 'pu-1', role: 'member' }
  mockValidate.mockResolvedValue({ ok: true, errors: [] })
  seed()
})

describe('getManageableTemplateWorkspaces', () => {
  it('returns only workspaces where the caller is owner or admin', async () => {
    const { getManageableTemplateWorkspaces } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'admin'], [OTHER_WORKSPACE_ID, 'member']]))
    expect(await getManageableTemplateWorkspaces()).toEqual([{ id: WORKSPACE_ID, name: 'Platform' }])
  })

  it('returns nothing for a plain member', async () => {
    const { getManageableTemplateWorkspaces } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    expect(await getManageableTemplateWorkspaces()).toEqual([])
  })

  it('returns nothing when unauthenticated', async () => {
    const { getManageableTemplateWorkspaces } = await import('./editor-actions')
    mockSessionUser = null
    expect(await getManageableTemplateWorkspaces()).toEqual([])
  })

  it('gives a platform admin every workspace', async () => {
    const { getManageableTemplateWorkspaces } = await import('./editor-actions')
    mockPayloadUser = { id: 'pu-1', role: 'super_admin' }
    fake.setRoles(new Map())
    const result = await getManageableTemplateWorkspaces()
    expect(result.map((w) => w.id).sort()).toEqual([WORKSPACE_ID, OTHER_WORKSPACE_ID].sort())
  })
})

describe('listRunnableTemplates', () => {
  it('lists only published definitions in the caller’s own workspaces', async () => {
    seed({
      'template-definitions': [
        { ...DEFINITION, id: 'pub-1', status: 'published' },
        { ...DEFINITION, id: 'draft-1', status: 'draft' },
        { ...DEFINITION, id: 'other-ws', status: 'published', workspace: OTHER_WORKSPACE_ID },
      ],
    })
    const { listRunnableTemplates } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    expect((await listRunnableTemplates()).map((t) => t.id)).toEqual(['pub-1'])
  })

  it('returns nothing when the caller is a member of no workspace', async () => {
    const { listRunnableTemplates } = await import('./editor-actions')
    fake.setRoles(new Map())
    expect(await listRunnableTemplates()).toEqual([])
  })

  it('defaults lastDryRunStatus to unknown, and passes through a sweep-recorded value (Phase 4 Task G)', async () => {
    seed({
      'template-definitions': [
        { ...DEFINITION, id: 'pub-1', status: 'published' },
        { ...DEFINITION, id: 'pub-2', status: 'published', lastDryRunStatus: 'drifted' },
      ],
    })
    const { listRunnableTemplates } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    const items = await listRunnableTemplates()
    expect(items.find((t) => t.id === 'pub-1')?.lastDryRunStatus).toBe('unknown')
    expect(items.find((t) => t.id === 'pub-2')?.lastDryRunStatus).toBe('drifted')
  })

  it('never leaks fixture contents to the catalog projection', async () => {
    seed({
      'template-definitions': [
        {
          ...DEFINITION,
          status: 'published',
          fixtures: [{ id: 'f1', name: 'secretish', values: { token: 'hunter2' } }],
        },
      ],
    })
    const { listRunnableTemplates } = await import('./editor-actions')
    const [item] = await listRunnableTemplates()
    expect(JSON.stringify(item)).not.toContain('hunter2')
  })
})

describe('listAuthorableTemplates', () => {
  it('scopes to workspaces the caller can manage', async () => {
    seed({
      'template-definitions': [
        DEFINITION,
        { ...DEFINITION, id: 'other-ws', workspace: OTHER_WORKSPACE_ID },
      ],
    })
    const { listAuthorableTemplates } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'owner'], [OTHER_WORKSPACE_ID, 'member']]))
    expect((await listAuthorableTemplates()).map((t) => t.id)).toEqual(['def-1'])
  })

  it('returns nothing for a caller who manages no workspace', async () => {
    const { listAuthorableTemplates } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    expect(await listAuthorableTemplates()).toEqual([])
  })

  it('filters "mine" in the query rather than after the row cap', async () => {
    seed({
      'template-definitions': [
        DEFINITION,
        { ...DEFINITION, id: 'theirs', createdBy: 'user-2' },
      ],
    })
    const { listAuthorableTemplates } = await import('./editor-actions')
    expect((await listAuthorableTemplates({ mine: true })).map((t) => t.id)).toEqual(['def-1'])
    expect((await listAuthorableTemplates()).map((t) => t.id).sort()).toEqual(['def-1', 'theirs'])
  })

  it('includes published definitions, so Deprecate stays reachable', async () => {
    seed({
      'template-definitions': [{ ...DEFINITION, id: 'pub-1', status: 'published' }],
    })
    const { listAuthorableTemplates } = await import('./editor-actions')
    expect((await listAuthorableTemplates()).map((t) => t.id)).toEqual(['pub-1'])
  })
})

describe('listTemplateDefinitionVersions', () => {
  it('returns the versions with their publish-gate facts, newest first', async () => {
    seed({
      'template-definition-versions': [
        VERSION,
        { ...VERSION, id: 'ver-2', versionNumber: 2, validatedAt: 'now', dryRunRunId: 'run-1' },
      ],
    })
    const { listTemplateDefinitionVersions } = await import('./editor-actions')
    const rows = await listTemplateDefinitionVersions('def-1')
    expect(rows.map((r) => r.versionNumber)).toEqual([2, 1])
    expect(rows[0]).toMatchObject({ validatedAt: 'now', dryRunRunId: 'run-1', isCurrent: false })
    expect(rows[1].isCurrent).toBe(true)
  })

  it('returns nothing to a caller who cannot manage the workspace', async () => {
    const { listTemplateDefinitionVersions } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    expect(await listTemplateDefinitionVersions('def-1')).toEqual([])
  })
})

describe('markVersionValidated', () => {
  it('validates the PERSISTED definitionJson, not anything from the caller', async () => {
    const { markVersionValidated } = await import('./editor-actions')
    await markVersionValidated('ver-1')
    expect(mockValidate).toHaveBeenCalledWith(VERSION.definitionJson)
  })

  it('stamps validatedAt when validation passes', async () => {
    const { markVersionValidated } = await import('./editor-actions')
    const result = await markVersionValidated('ver-1')
    expect(result.ok).toBe(true)
    const stamped = fake.col('template-definition-versions').get('ver-1')
    expect(typeof stamped?.validatedAt).toBe('string')
  })

  it('CLEARS validatedAt when validation fails, so a stale pass cannot satisfy the gate', async () => {
    seed({ 'template-definition-versions': [{ ...VERSION, validatedAt: 'earlier' }] })
    mockValidate.mockResolvedValue({ ok: false, errors: [{ path: 'spec', message: 'bad' }] })
    const { markVersionValidated } = await import('./editor-actions')
    const result = await markVersionValidated('ver-1')
    expect(result.ok).toBe(false)
    expect(fake.col('template-definition-versions').get('ver-1')?.validatedAt).toBeNull()
  })

  it('refuses a caller who cannot manage the definition’s workspace', async () => {
    const { markVersionValidated } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    await expect(markVersionValidated('ver-1')).rejects.toThrow(/permission/i)
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('throws on an unknown version rather than creating one', async () => {
    const { markVersionValidated } = await import('./editor-actions')
    await expect(markVersionValidated('nope')).rejects.toThrow(/not found/i)
  })

  it('refuses when unauthenticated', async () => {
    const { markVersionValidated } = await import('./editor-actions')
    mockSessionUser = null
    await expect(markVersionValidated('ver-1')).rejects.toThrow(/not authenticated/i)
  })
})

describe('recordSuccessfulDryRun', () => {
  it('stamps dryRunRunId for a succeeded dry run of that version', async () => {
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    expect(await recordSuccessfulDryRun('ver-1', 'run-1')).toEqual({ recorded: true })
    expect(fake.col('template-definition-versions').get('ver-1')?.dryRunRunId).toBe('run-1')
  })

  it('refuses a run that did not succeed', async () => {
    seed({ 'action-runs': [{ ...SUCCEEDED_DRY_RUN, status: 'failed' }] })
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    expect(await recordSuccessfulDryRun('ver-1', 'run-1')).toEqual({ recorded: false })
    expect(fake.col('template-definition-versions').get('ver-1')?.dryRunRunId).toBeNull()
  })

  it('refuses a REAL run — a live run cannot satisfy the dry-run gate', async () => {
    seed({ 'action-runs': [{ ...SUCCEEDED_DRY_RUN, dryRun: false }] })
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    expect(await recordSuccessfulDryRun('ver-1', 'run-1')).toEqual({ recorded: false })
    expect(fake.col('template-definition-versions').get('ver-1')?.dryRunRunId).toBeNull()
  })

  it('refuses a succeeded dry run belonging to a DIFFERENT version', async () => {
    seed({ 'action-runs': [{ ...SUCCEEDED_DRY_RUN, templateVersion: 'ver-99' }] })
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    expect(await recordSuccessfulDryRun('ver-1', 'run-1')).toEqual({ recorded: false })
    expect(fake.col('template-definition-versions').get('ver-1')?.dryRunRunId).toBeNull()
  })

  it('refuses a caller who cannot manage the definition’s workspace', async () => {
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    fake.setRoles(new Map([[WORKSPACE_ID, 'member']]))
    await expect(recordSuccessfulDryRun('ver-1', 'run-1')).rejects.toThrow(/permission/i)
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('refuses a run belonging to a DIFFERENT workspace than the definition', async () => {
    // Defence in depth against a confused-deputy stamp: the caller is a
    // legitimate owner of the definition's workspace, and the run claims the
    // right templateVersion, but the run row itself lives in another
    // workspace. Nothing should be stamped from a cross-tenant run.
    seed({ 'action-runs': [{ ...SUCCEEDED_DRY_RUN, workspace: OTHER_WORKSPACE_ID }] })
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    expect(await recordSuccessfulDryRun('ver-1', 'run-1')).toEqual({ recorded: false })
    expect(fake.col('template-definition-versions').get('ver-1')?.dryRunRunId).toBeNull()
  })

  it('still stamps when the run carries a populated workspace object', async () => {
    // `depth` can populate the relationship; the check compares ids, not refs.
    seed({
      'action-runs': [
        { ...SUCCEEDED_DRY_RUN, workspace: { id: WORKSPACE_ID, name: 'Platform' } },
      ],
    })
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    expect(await recordSuccessfulDryRun('ver-1', 'run-1')).toEqual({ recorded: true })
  })

  it('throws on an unknown run rather than stamping', async () => {
    const { recordSuccessfulDryRun } = await import('./editor-actions')
    await expect(recordSuccessfulDryRun('ver-1', 'nope')).rejects.toThrow(/not found/i)
    expect(fake.col('template-definition-versions').get('ver-1')?.dryRunRunId).toBeNull()
  })
})
