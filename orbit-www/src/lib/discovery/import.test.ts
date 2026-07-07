import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import type { DiscoveredEntity } from '@/payload-types'
import {
  computeDedupeKey,
  importDiscoveredService,
  importDiscoveredApi,
  importDiscovery,
} from './import'

// --- FakePayload -------------------------------------------------------------
//
// Minimal in-memory Payload stand-in mirroring the pattern in
// scorecards/snapshots.test.ts — just enough find/create/update to exercise the
// discovery import lib (apps, api-schemas, discovered-entities).

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    apps: [],
    'api-schemas': [],
    'discovered-entities': [],
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

/** Supports the nested `repository.owner` dot-path queries the import lib uses. */
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

// --- fixtures ----------------------------------------------------------------

function discovery(partial: Partial<DiscoveredEntity> = {}): DiscoveredEntity {
  return {
    id: partial.id ?? 'disc-1',
    workspace: partial.workspace ?? 'ws1',
    installation: partial.installation ?? 'inst-1',
    repo: partial.repo ?? { owner: 'acme', name: 'billing', defaultBranch: 'main' },
    path: partial.path ?? '',
    detectedKind: partial.detectedKind ?? 'service',
    confidence: partial.confidence ?? 'high',
    evidence: partial.evidence ?? [],
    proposal: partial.proposal ?? {},
    status: partial.status ?? 'proposed',
    dedupeKey: partial.dedupeKey ?? 'key-1',
    updatedAt: '2026-07-06T00:00:00.000Z',
    createdAt: '2026-07-06T00:00:00.000Z',
    ...partial,
  } as DiscoveredEntity
}

// --- computeDedupeKey --------------------------------------------------------

describe('computeDedupeKey', () => {
  it('is a deterministic sha1 hex of installationId:owner/name:path:detectedKind', () => {
    const key = computeDedupeKey('42', 'acme/billing', '', 'service')
    expect(key).toMatch(/^[0-9a-f]{40}$/)
    expect(key).toBe(computeDedupeKey('42', 'acme/billing', '', 'service'))
  })

  it('differs across kind and path components', () => {
    const base = computeDedupeKey('42', 'acme/billing', '', 'service')
    expect(computeDedupeKey('42', 'acme/billing', '', 'api')).not.toBe(base)
    expect(computeDedupeKey('42', 'acme/billing', 'sub', 'service')).not.toBe(base)
    expect(computeDedupeKey('43', 'acme/billing', '', 'service')).not.toBe(base)
  })
})

// --- importDiscoveredService -------------------------------------------------

describe('importDiscoveredService', () => {
  it('creates a discovered App with origin.type discovered and buildConfig from the proposal', async () => {
    const f = fp()
    const d = discovery({
      proposal: { name: 'billing-svc', description: 'Billing', buildConfig: { language: 'go' } },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.imported).toBe(true)
    expect(res.ref?.collection).toBe('apps')
    const apps = f.collections['apps']
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({
      workspace: 'ws1',
      name: 'billing-svc',
      description: 'Billing',
      origin: { type: 'discovered' },
      repository: { owner: 'acme', name: 'billing', branch: 'main' },
      buildConfig: { language: 'go' },
      syncEnabled: false,
    })
    // discovery row linked
    const row = f.collections['discovered-entities'][0]
    expect(row.status).toBe('imported')
    expect(row.importedRef).toEqual({ collection: 'apps', id: apps[0].id })
  })

  it('no-op links to an existing App for the same repo (idempotent, edits preserved)', async () => {
    const f = fp()
    f.collections['apps'] = [
      { id: 'app-existing', workspace: 'ws1', name: 'HAND-EDITED', repository: { owner: 'acme', name: 'billing' } },
    ]
    const d = discovery({ proposal: { name: 'billing-svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.ref).toEqual({ collection: 'apps', id: 'app-existing' })
    // no new App created, existing name untouched
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['apps'][0].name).toBe('HAND-EDITED')
    expect(f.collections['discovered-entities'][0].importedRef).toEqual({
      collection: 'apps',
      id: 'app-existing',
    })
  })

  it('short-circuits when the row is already imported', async () => {
    const f = fp()
    const d = discovery({ status: 'imported', importedRef: { collection: 'apps', id: 'app-x' } })

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res).toEqual({ imported: true, ref: { collection: 'apps', id: 'app-x' } })
    expect(f.collections['apps']).toHaveLength(0)
  })

  it('re-import is idempotent: second call links to the same App, no duplicate', async () => {
    const f = fp()
    const d = discovery({ proposal: { name: 'billing-svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    await importDiscoveredService(payloadOf(f), d)
    const linked = { ...f.collections['discovered-entities'][0] } as unknown as DiscoveredEntity
    await importDiscoveredService(payloadOf(f), linked)

    expect(f.collections['apps']).toHaveLength(1)
  })
})

// --- importDiscoveredApi -----------------------------------------------------

describe('importDiscoveredApi', () => {
  it('creates an api-schemas row and links it to the repo App when one exists', async () => {
    const f = fp()
    f.collections['apps'] = [
      { id: 'app-1', workspace: 'ws1', repository: { owner: 'acme', name: 'billing' } },
    ]
    const d = discovery({
      detectedKind: 'api',
      proposal: {
        schemaType: 'openapi',
        specPath: 'openapi.yaml',
        specTitle: 'Billing API',
        rawContent: 'openapi: 3.0.0',
      },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d, { actorUserId: 'user-9' })

    expect(res.imported).toBe(true)
    const schemas = f.collections['api-schemas']
    expect(schemas).toHaveLength(1)
    expect(schemas[0]).toMatchObject({
      name: 'Billing API',
      workspace: 'ws1',
      schemaType: 'openapi',
      rawContent: 'openapi: 3.0.0',
      repositoryPath: 'openapi.yaml',
      repository: 'app-1',
      createdBy: 'user-9',
    })
    expect(f.collections['discovered-entities'][0].status).toBe('imported')
    expect(f.collections['discovered-entities'][0].importedRef).toEqual({
      collection: 'api-schemas',
      id: schemas[0].id,
    })
  })

  it('creates the api-schemas row without a repository rel when no App exists', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'asyncapi', specPath: 'asyncapi.yaml', rawContent: 'asyncapi: 2.6.0' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d, { actorUserId: 'user-1' })

    expect(res.imported).toBe(true)
    expect(f.collections['api-schemas'][0].repository).toBeUndefined()
  })

  it('skips the create (missing-actor) when no actorUserId is supplied for a new spec', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'openapi', specPath: 'openapi.yaml', rawContent: 'openapi: 3.0.0' },
    })

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res).toEqual({ imported: false, skippedReason: 'missing-actor' })
    expect(f.collections['api-schemas']).toHaveLength(0)
  })

  it('SKIPS graphql proposals with an explicit reason (schemaType not in api-schemas enum)', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'graphql', specPath: 'schema.graphql', rawContent: 'type Query { a: String }' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res).toEqual({ imported: false, skippedReason: 'unsupported-schema-type:graphql' })
    expect(f.collections['api-schemas']).toHaveLength(0)
    // proposal row untouched — still available in the review queue
    expect(f.collections['discovered-entities'][0].status).toBe('proposed')
  })

  it('skips filename-only proposals that carry no rawContent', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      confidence: 'medium',
      proposal: { schemaType: 'openapi', specPath: 'docs/openapi.yaml' },
    })

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res).toEqual({ imported: false, skippedReason: 'missing-raw-content' })
    expect(f.collections['api-schemas']).toHaveLength(0)
  })

  it('is idempotent: an existing api-schemas row for the same workspace+path+App is linked, not duplicated', async () => {
    const f = fp()
    f.collections['apps'] = [
      { id: 'app-1', workspace: 'ws1', repository: { owner: 'acme', name: 'billing' } },
    ]
    f.collections['api-schemas'] = [
      { id: 'schema-existing', workspace: 'ws1', repositoryPath: 'openapi.yaml', repository: 'app-1' },
    ]
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'openapi', specPath: 'openapi.yaml', rawContent: 'openapi: 3.0.0' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res.ref).toEqual({ collection: 'api-schemas', id: 'schema-existing' })
    expect(f.collections['api-schemas']).toHaveLength(1)
    expect(f.collections['discovered-entities'][0].importedRef).toEqual({
      collection: 'api-schemas',
      id: 'schema-existing',
    })
  })

  it('short-circuits when the row is already imported', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      status: 'imported',
      importedRef: { collection: 'api-schemas', id: 'schema-x' },
      proposal: { schemaType: 'openapi', specPath: 'openapi.yaml', rawContent: 'openapi: 3.0.0' },
    })

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res).toEqual({ imported: true, ref: { collection: 'api-schemas', id: 'schema-x' } })
    expect(f.collections['api-schemas']).toHaveLength(0)
  })
})

// --- importDiscovery (dispatcher) -------------------------------------------

describe('importDiscovery', () => {
  it('routes service kinds to the service importer', async () => {
    const f = fp()
    const d = discovery({ detectedKind: 'service', proposal: { name: 'svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscovery(payloadOf(f), d)

    expect(res.ref?.collection).toBe('apps')
    expect(f.collections['apps']).toHaveLength(1)
  })

  it('routes api kinds to the api importer and threads actorUserId', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'openapi', specPath: 'openapi.yaml', rawContent: 'openapi: 3.0.0' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscovery(payloadOf(f), d, { actorUserId: 'user-7' })

    expect(res.ref?.collection).toBe('api-schemas')
    expect(f.collections['api-schemas'][0].createdBy).toBe('user-7')
  })
})
