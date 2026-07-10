import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'
import type { DiscoveredEntity } from '@/payload-types'
import {
  catalogScanWorkflowId,
  sortDiscoveries,
  listDiscoveriesCore,
  listGlobalDiscoveriesCore,
  approveDiscoveriesCore,
  ignoreDiscoveriesCore,
  startWorkspaceScanCore,
  startInstallationScanCore,
} from './actions-core'

// --- FakePayload -------------------------------------------------------------
//
// In-memory Payload stand-in mirroring import.test.ts, extended with findByID
// and a workspace-members collection so the real getWorkspaceMembership RBAC
// helper runs against it (no mocking of the authz path — the point of the test).

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    'workspace-members': [],
    'discovered-entities': [],
    apps: [],
    'api-schemas': [],
  }
  private counter = 1

  private nextId(collection: string): string {
    return `${collection}-${this.counter++}`
  }

  async find({
    collection,
    where,
    limit = 100,
  }: {
    collection: string
    where?: unknown
    limit?: number
  }) {
    const all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    return { docs: all.slice(0, limit), hasNextPage: false }
  }

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`findByID: ${collection}/${id} not found`)
    return doc
  }

  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const doc = { id: this.nextId(collection), ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }

  async update({
    collection,
    id,
    data,
  }: {
    collection: string
    id: string
    data: Record<string, unknown>
  }) {
    const list = this.collections[collection] ?? []
    const doc = list.find((d) => d.id === id)
    if (!doc) throw new Error(`update: ${collection}/${id} not found`)
    Object.assign(doc, data)
    return doc
  }
}

function getField(doc: Doc, field: string): unknown {
  if (field.includes('.')) {
    return field.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
      return undefined
    }, doc)
  }
  return doc[field]
}

function matchesWhere(doc: Doc, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) return (w.and as unknown[]).every((c) => matchesWhere(doc, c))
  if (Array.isArray(w.or)) return (w.or as unknown[]).some((c) => matchesWhere(doc, c))

  for (const [field, condRaw] of Object.entries(w)) {
    const cond = condRaw as Record<string, unknown>
    const raw = getField(doc, field)
    const actualId = raw && typeof raw === 'object' ? (raw as Doc).id : raw
    if ('equals' in cond) {
      if (actualId !== cond.equals) return false
    } else if ('in' in cond) {
      if (!(cond.in as unknown[]).includes(actualId)) return false
    } else if ('exists' in cond) {
      const present = actualId !== undefined && actualId !== null
      if (present !== cond.exists) return false
    }
  }
  return true
}

function fp() {
  return new FakePayload()
}
function payloadOf(f: FakePayload) {
  return f as unknown as Payload
}

const AUTH_ID = 'better-auth-user-1'

/** Seed an active membership so getWorkspaceMembership resolves the caller. */
function seedMember(f: FakePayload, workspaceId: string, betterAuthId = AUTH_ID, role = 'member') {
  f.collections['workspace-members'].push({
    id: `wm-${workspaceId}-${betterAuthId}`,
    workspace: workspaceId,
    user: betterAuthId,
    role,
    status: 'active',
  })
}

function seedDiscovery(f: FakePayload, partial: Partial<DiscoveredEntity> & { id: string }) {
  const row: Doc = {
    id: partial.id,
    workspace: 'ws1',
    installation: 'inst-1',
    repo: { owner: 'acme', name: 'billing', defaultBranch: 'main' },
    path: '',
    detectedKind: 'service',
    confidence: 'high',
    evidence: [],
    proposal: {},
    status: 'proposed',
    dedupeKey: `key-${partial.id}`,
    ...(partial as Record<string, unknown>),
  } as Doc
  f.collections['discovered-entities'].push(row)
  return row
}

// --- catalogScanWorkflowId ---------------------------------------------------

describe('catalogScanWorkflowId', () => {
  it('keys on the numeric installation id', () => {
    expect(catalogScanWorkflowId('12345')).toBe('catalog-scan-12345')
  })
})

// --- sortDiscoveries ---------------------------------------------------------

describe('sortDiscoveries', () => {
  it('orders by repo (owner/name) then path', () => {
    const rows = [
      { id: 'c', repo: { owner: 'acme', name: 'web' }, path: 'services/b' },
      { id: 'a', repo: { owner: 'acme', name: 'api' }, path: '' },
      { id: 'b', repo: { owner: 'acme', name: 'web' }, path: 'services/a' },
    ] as unknown as DiscoveredEntity[]
    expect(sortDiscoveries(rows).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

// --- listDiscoveriesCore -----------------------------------------------------

describe('listDiscoveriesCore', () => {
  it('returns the workspace rows sorted, honouring status/kind filters', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, { id: 'd1', repo: { owner: 'acme', name: 'web' }, detectedKind: 'api', status: 'proposed' })
    seedDiscovery(f, { id: 'd2', repo: { owner: 'acme', name: 'api' }, detectedKind: 'service', status: 'proposed' })
    seedDiscovery(f, { id: 'd3', repo: { owner: 'acme', name: 'zzz' }, detectedKind: 'service', status: 'ignored' })

    const all = await listDiscoveriesCore(payloadOf(f), AUTH_ID, 'ws1')
    expect(all.map((r) => r.id)).toEqual(['d2', 'd1', 'd3'])

    const proposed = await listDiscoveriesCore(payloadOf(f), AUTH_ID, 'ws1', { status: 'proposed' })
    expect(proposed.map((r) => r.id).sort()).toEqual(['d1', 'd2'])

    const services = await listDiscoveriesCore(payloadOf(f), AUTH_ID, 'ws1', { kind: 'service' })
    expect(services.map((r) => r.id).sort()).toEqual(['d2', 'd3'])
  })

  it('returns [] for a non-member (tenant isolation, AC-7)', async () => {
    const f = fp()
    seedDiscovery(f, { id: 'd1' })
    expect(await listDiscoveriesCore(payloadOf(f), AUTH_ID, 'ws1')).toEqual([])
  })
})

// --- approveDiscoveriesCore --------------------------------------------------

describe('approveDiscoveriesCore', () => {
  it('imports a service proposal for a member and reports imported', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, { id: 'd1', proposal: { name: 'billing', buildConfig: { language: 'go' } } })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, ['d1'])
    expect(res).toEqual([
      { id: 'd1', imported: true, ref: { collectionSlug: 'apps', docId: expect.any(String) } },
    ])
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['discovered-entities'][0].status).toBe('imported')
  })

  it('surfaces the imported ref (collectionSlug + docId) so the UI can link to what it created', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, { id: 'd1', proposal: { name: 'billing' } })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, ['d1'])
    const appId = f.collections['apps'][0].id
    expect(res[0].ref).toEqual({ collectionSlug: 'apps', docId: appId })
  })

  it('passes the acting member as the api-schemas actor (createdBy)', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, {
      id: 'd1',
      detectedKind: 'api',
      proposal: { name: 'orders', schemaType: 'openapi', rawContent: 'openapi: 3.0.0', specPath: 'openapi.yaml' },
    })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, ['d1'])
    expect(res).toEqual([
      { id: 'd1', imported: true, ref: { collectionSlug: 'api-schemas', docId: expect.any(String) } },
    ])
    expect(f.collections['api-schemas'][0]).toMatchObject({ createdBy: 'payload-user-9' })
  })

  it('imports a graphql proposal into api-schemas', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, {
      id: 'd1',
      detectedKind: 'api',
      proposal: { name: 'graph', schemaType: 'graphql', rawContent: 'type Query { a: String }' },
    })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, ['d1'])
    expect(res).toEqual([
      { id: 'd1', imported: true, ref: { collectionSlug: 'api-schemas', docId: expect.any(String) } },
    ])
    expect(f.collections['api-schemas']).toHaveLength(1)
    expect(f.collections['api-schemas'][0]).toMatchObject({ schemaType: 'graphql' })
  })

  it('surfaces the import skippedReason for a genuinely unsupported schema type instead of throwing', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, {
      id: 'd1',
      detectedKind: 'api',
      proposal: { name: 'proto', schemaType: 'protobuf', rawContent: 'syntax = "proto3";' },
    })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, ['d1'])
    expect(res).toEqual([{ id: 'd1', imported: false, skippedReason: 'unsupported-schema-type:protobuf' }])
    expect(f.collections['api-schemas']).toHaveLength(0)
  })

  it('fails a single forbidden / missing id without aborting the batch', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, { id: 'mine', proposal: { name: 'ok' } })
    seedDiscovery(f, { id: 'theirs', workspace: 'ws2', proposal: { name: 'nope' } })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, [
      'mine',
      'theirs',
      'ghost',
    ])
    expect(res).toEqual([
      { id: 'mine', imported: true, ref: { collectionSlug: 'apps', docId: expect.any(String) } },
      { id: 'theirs', imported: false, skippedReason: 'forbidden' },
      { id: 'ghost', imported: false, skippedReason: 'not-found' },
    ])
    expect(f.collections['apps']).toHaveLength(1)
  })
})

// --- global (workspace-less) proposals (WP8) ---------------------------------

describe('approveDiscoveriesCore — global rows (WP8)', () => {
  it('imports a global proposal as a global catalog entity for a platform admin', async () => {
    const f = fp()
    // No workspace on the row = global. Admin, no membership needed.
    seedDiscovery(f, { id: 'g1', workspace: undefined, proposal: { name: 'billing' } })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', true, ['g1'])

    expect(res).toEqual([
      { id: 'g1', imported: true, ref: { collectionSlug: 'catalog-entities', docId: expect.any(String) } },
    ])
    const entities = f.collections['catalog-entities'] ?? []
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ kind: 'service', source: { type: 'scan' } })
    expect(f.collections['apps'] ?? []).toHaveLength(0)
    const row = f.collections['discovered-entities'][0]
    expect(row.status).toBe('imported')
    expect((row.importedRef as { collectionSlug: string }).collectionSlug).toBe('catalog-entities')
  })

  it('forbids a non-admin from approving a global proposal', async () => {
    const f = fp()
    seedMember(f, 'ws1') // caller is a member of ws1, but the row is global
    seedDiscovery(f, { id: 'g1', workspace: undefined })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', false, ['g1'])

    expect(res).toEqual([{ id: 'g1', imported: false, skippedReason: 'forbidden' }])
    expect(f.collections['catalog-entities'] ?? []).toHaveLength(0)
  })

  it('assigns a global proposal to a workspace and imports through the apps path', async () => {
    const f = fp()
    seedDiscovery(f, { id: 'g1', workspace: undefined, proposal: { name: 'billing', buildConfig: { language: 'go' } } })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', true, ['g1'], {
      assignWorkspaceId: 'ws-target',
    })

    expect(res).toEqual([
      { id: 'g1', imported: true, ref: { collectionSlug: 'apps', docId: expect.any(String) } },
    ])
    // Normal workspace import path ran: an apps row, no global catalog entity.
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['apps'][0]).toMatchObject({ workspace: 'ws-target', origin: { type: 'discovered' } })
    expect(f.collections['catalog-entities'] ?? []).toHaveLength(0)
    // The discovery row was reassigned to the workspace.
    expect(f.collections['discovered-entities'][0].workspace).toBe('ws-target')
  })

  it('lets a platform admin approve any workspace row without membership', async () => {
    const f = fp()
    seedDiscovery(f, { id: 'w1', workspace: 'ws-other', proposal: { name: 'ok' } })

    const res = await approveDiscoveriesCore(payloadOf(f), AUTH_ID, 'payload-user-9', true, ['w1'])
    expect(res).toEqual([
      { id: 'w1', imported: true, ref: { collectionSlug: 'apps', docId: expect.any(String) } },
    ])
    expect(f.collections['apps']).toHaveLength(1)
  })
})

describe('ignoreDiscoveriesCore — global rows (WP8)', () => {
  it('lets an admin ignore a global row but forbids a non-admin', async () => {
    const f = fp()
    seedDiscovery(f, { id: 'g1', workspace: undefined, status: 'proposed' })

    const denied = await ignoreDiscoveriesCore(payloadOf(f), AUTH_ID, false, ['g1'])
    expect(denied).toEqual([{ id: 'g1', ignored: false, reason: 'forbidden' }])

    const ok = await ignoreDiscoveriesCore(payloadOf(f), AUTH_ID, true, ['g1'])
    expect(ok).toEqual([{ id: 'g1', ignored: true }])
    expect(f.collections['discovered-entities'][0].status).toBe('ignored')
  })
})

describe('listGlobalDiscoveriesCore', () => {
  it('returns only workspace-less rows for an admin, sorted', async () => {
    const f = fp()
    seedDiscovery(f, { id: 'g2', workspace: undefined, repo: { owner: 'acme', name: 'zzz' } })
    seedDiscovery(f, { id: 'g1', workspace: undefined, repo: { owner: 'acme', name: 'aaa' } })
    seedDiscovery(f, { id: 'w1', workspace: 'ws1' }) // scoped — excluded

    const rows = await listGlobalDiscoveriesCore(payloadOf(f), true)
    expect(rows.map((r) => r.id)).toEqual(['g1', 'g2'])
  })

  it('returns [] for a non-admin (AC-7 for the global queue)', async () => {
    const f = fp()
    seedDiscovery(f, { id: 'g1', workspace: undefined })
    expect(await listGlobalDiscoveriesCore(payloadOf(f), false)).toEqual([])
  })
})

describe('startInstallationScanCore', () => {
  it('starts a global scan with an empty workspaceId for an admin', async () => {
    const start = vi.fn(async ({ installationId }: { installationId: string }) => `catalog-scan-${installationId}`)
    const res = await startInstallationScanCore(true, 12345, start)
    expect(start).toHaveBeenCalledWith({ installationId: '12345', workspaceId: '' })
    expect(res.started).toEqual({ installationId: '12345', workflowId: 'catalog-scan-12345' })
  })

  it('returns null started when the starter reports a transient failure', async () => {
    const res = await startInstallationScanCore(true, 1, async () => null)
    expect(res.started).toBeNull()
  })

  it('throws for a non-admin', async () => {
    await expect(startInstallationScanCore(false, 1, async () => 'x')).rejects.toThrow(/platform admin/i)
  })
})

// --- ignoreDiscoveriesCore ---------------------------------------------------

describe('ignoreDiscoveriesCore', () => {
  it('sets member rows to ignored, guards forbidden and already-imported', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    seedDiscovery(f, { id: 'mine', status: 'proposed' })
    seedDiscovery(f, { id: 'done', status: 'imported' })
    seedDiscovery(f, { id: 'theirs', workspace: 'ws2', status: 'proposed' })

    const res = await ignoreDiscoveriesCore(payloadOf(f), AUTH_ID, false, ['mine', 'done', 'theirs'])
    expect(res).toEqual([
      { id: 'mine', ignored: true },
      { id: 'done', ignored: false, reason: 'already-imported' },
      { id: 'theirs', ignored: false, reason: 'forbidden' },
    ])
    expect(f.collections['discovered-entities'].find((d) => d.id === 'mine')?.status).toBe('ignored')
    expect(f.collections['discovered-entities'].find((d) => d.id === 'theirs')?.status).toBe('proposed')
  })
})

// --- startWorkspaceScanCore --------------------------------------------------

describe('startWorkspaceScanCore', () => {
  it('starts one workflow per installation with the numeric id (string)', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    const start = vi.fn(async ({ installationId }: { installationId: string }) => `catalog-scan-${installationId}`)

    const res = await startWorkspaceScanCore(
      payloadOf(f),
      AUTH_ID,
      'ws1',
      [{ installationId: 12345 }, { installationId: 67890 }],
      start,
    )

    expect(start).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledWith({ installationId: '12345', workspaceId: 'ws1' })
    expect(res.started).toEqual([
      { installationId: '12345', workflowId: 'catalog-scan-12345' },
      { installationId: '67890', workflowId: 'catalog-scan-67890' },
    ])
  })

  it('skips an installation whose workflow failed to start (null)', async () => {
    const f = fp()
    seedMember(f, 'ws1')
    const start = vi.fn(async ({ installationId }: { installationId: string }) =>
      installationId === '1' ? null : `catalog-scan-${installationId}`,
    )

    const res = await startWorkspaceScanCore(
      payloadOf(f),
      AUTH_ID,
      'ws1',
      [{ installationId: 1 }, { installationId: 2 }],
      start,
    )
    expect(res.started).toEqual([{ installationId: '2', workflowId: 'catalog-scan-2' }])
  })

  it('throws for a non-member (AC-7)', async () => {
    const f = fp()
    await expect(
      startWorkspaceScanCore(payloadOf(f), AUTH_ID, 'ws1', [{ installationId: 1 }], async () => 'x'),
    ).rejects.toThrow(/not a member/i)
  })
})
