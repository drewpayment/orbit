import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import type { DiscoveredEntity } from '@/payload-types'
import {
  computeDedupeKey,
  importDiscoveredService,
  importDiscoveredApi,
  importDiscoveredGlobalEntity,
  importDiscovery,
  pickNearestApp,
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

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`findByID: ${collection}/${id} not found`)
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
    expect(row.importedRef).toEqual({ collectionSlug: 'apps', docId: apps[0].id })
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
      collectionSlug: 'apps',
      docId: 'app-existing',
    })
  })

  it('short-circuits when the row is already imported', async () => {
    const f = fp()
    const d = discovery({ status: 'imported', importedRef: { collectionSlug: 'apps', docId: 'app-x' } })

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res).toEqual({ imported: true, ref: { collection: 'apps', id: 'app-x' } })
    expect(f.collections['apps']).toHaveLength(0)
  })

  it('creates a separate App per sub-app path from one monorepo repo (QA repro — no silent link to the first app)', async () => {
    const f = fp()
    const web = discovery({ id: 'disc-web', path: 'apps/web-next', proposal: { name: 'web-next' } })
    const api = discovery({ id: 'disc-api', path: 'apps/api', proposal: { name: 'api' } })
    f.collections['discovered-entities'] = [{ ...web } as Doc, { ...api } as Doc]

    const r1 = await importDiscoveredService(payloadOf(f), web)
    const r2 = await importDiscoveredService(payloadOf(f), api)

    // Two distinct apps, one per sub-app dir.
    expect(f.collections['apps']).toHaveLength(2)
    expect(r1.ref!.id).not.toBe(r2.ref!.id)
    const webApp = f.collections['apps'].find(
      (a) => (a.repository as Record<string, unknown>).path === 'apps/web-next',
    )!
    const apiApp = f.collections['apps'].find(
      (a) => (a.repository as Record<string, unknown>).path === 'apps/api',
    )!
    expect(webApp).toBeDefined()
    expect(apiApp).toBeDefined()
    // Each discovery row links to its OWN app.
    const webRow = f.collections['discovered-entities'].find((r) => r.id === 'disc-web')!
    const apiRow = f.collections['discovered-entities'].find((r) => r.id === 'disc-api')!
    expect((webRow.importedRef as Record<string, unknown>).docId).toBe(webApp.id)
    expect((apiRow.importedRef as Record<string, unknown>).docId).toBe(apiApp.id)
  })

  it('a sub-app proposal never links to the repo-root App (the data-loss bug)', async () => {
    const f = fp()
    // Legacy repo-root App with no repository.path.
    f.collections['apps'] = [
      { id: 'app-root', workspace: 'ws1', name: 'billing', repository: { owner: 'acme', name: 'billing' } },
    ]
    const api = discovery({ id: 'disc-api', path: 'apps/api', proposal: { name: 'api' } })
    f.collections['discovered-entities'] = [{ ...api } as Doc]

    const res = await importDiscoveredService(payloadOf(f), api)

    expect(res.ref!.id).not.toBe('app-root')
    expect(f.collections['apps']).toHaveLength(2)
    const created = f.collections['apps'].find((a) => a.id === res.ref!.id)!
    expect((created.repository as Record<string, unknown>).path).toBe('apps/api')
  })

  it('same-path proposal links to the existing sub-app App, no duplicate', async () => {
    const f = fp()
    f.collections['apps'] = [
      {
        id: 'app-api',
        workspace: 'ws1',
        name: 'api',
        repository: { owner: 'acme', name: 'billing', path: 'apps/api' },
      },
    ]
    const api = discovery({ id: 'disc-api', path: 'apps/api', proposal: { name: 'api' } })
    f.collections['discovered-entities'] = [{ ...api } as Doc]

    const res = await importDiscoveredService(payloadOf(f), api)

    expect(res.ref).toEqual({ collection: 'apps', id: 'app-api' })
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['discovered-entities'][0].importedRef).toEqual({
      collectionSlug: 'apps',
      docId: 'app-api',
    })
  })

  it('legacy App without repository.path is matched by a root-path proposal', async () => {
    const f = fp()
    f.collections['apps'] = [
      { id: 'app-legacy', workspace: 'ws1', name: 'billing', repository: { owner: 'acme', name: 'billing' } },
    ]
    const root = discovery({ id: 'disc-root', path: '', proposal: { name: 'billing-svc' } })
    f.collections['discovered-entities'] = [{ ...root } as Doc]

    const res = await importDiscoveredService(payloadOf(f), root)

    expect(res.ref).toEqual({ collection: 'apps', id: 'app-legacy' })
    expect(f.collections['apps']).toHaveLength(1)
  })

  it('writes the sub-app path onto the created App repository group', async () => {
    const f = fp()
    const api = discovery({ id: 'disc-api', path: 'apps/api', proposal: { name: 'api' } })
    f.collections['discovered-entities'] = [{ ...api } as Doc]

    await importDiscoveredService(payloadOf(f), api)

    expect((f.collections['apps'][0].repository as Record<string, unknown>).path).toBe('apps/api')
  })

  it('legacy imported row (collectionSlug only, no docId) backfills docId via the dedupe/App lookup', async () => {
    // Pre-rename rows persisted `importedRef.collectionSlug` but silently dropped
    // the Mongoose-reserved `id` subfield, so the ref is unlinkable. The fast-path
    // misses (no docId) and falls through to findRepoApp, which re-links AND
    // backfills docId so a "View imported" affordance works afterwards.
    const f = fp()
    f.collections['apps'] = [
      { id: 'app-legacy', workspace: 'ws1', name: 'billing', repository: { owner: 'acme', name: 'billing' } },
    ]
    const d = discovery({
      status: 'imported',
      importedRef: { collectionSlug: 'apps' },
      proposal: { name: 'billing-svc' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.ref).toEqual({ collection: 'apps', id: 'app-legacy' })
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['discovered-entities'][0].importedRef).toEqual({
      collectionSlug: 'apps',
      docId: 'app-legacy',
    })
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

  it('sets provider: github explicitly on a GitHub (installation-backed) accept', async () => {
    const f = fp()
    const d = discovery({ installation: 'inst-1', connection: undefined, proposal: { name: 'billing-svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    await importDiscoveredService(payloadOf(f), d)

    expect(f.collections['apps'][0]).toMatchObject({
      repository: { provider: 'github', owner: 'acme', name: 'billing', installationId: 'inst-1' },
    })
  })

  it('ADO accept: reconstructs owner=organization from the linked git-connections doc, keeps repo.owner as project', async () => {
    const f = fp()
    f.collections['git-connections'] = [
      { id: 'conn-1', organization: 'my-ado-org', name: 'ADO Conn' },
    ]
    const d = discovery({
      installation: undefined,
      connection: 'conn-1',
      repo: { owner: 'my-project', name: 'billing', defaultBranch: 'main' },
      proposal: { name: 'billing-svc' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.imported).toBe(true)
    expect(f.collections['apps'][0]).toMatchObject({
      repository: {
        provider: 'azure-devops',
        connection: 'conn-1',
        owner: 'my-ado-org',
        project: 'my-project',
        name: 'billing',
      },
    })
  })

  it('ADO accept is idempotent: re-import finds the App by the resolved org, not the raw discovered project owner', async () => {
    const f = fp()
    f.collections['git-connections'] = [{ id: 'conn-1', organization: 'my-ado-org' }]
    f.collections['apps'] = [
      {
        id: 'app-existing',
        workspace: 'ws1',
        name: 'billing',
        repository: { provider: 'azure-devops', connection: 'conn-1', owner: 'my-ado-org', project: 'my-project', name: 'billing' },
      },
    ]
    const d = discovery({
      installation: undefined,
      connection: 'conn-1',
      repo: { owner: 'my-project', name: 'billing' },
      proposal: { name: 'billing-svc' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.ref).toEqual({ collection: 'apps', id: 'app-existing' })
    expect(f.collections['apps']).toHaveLength(1)
  })

  it('fails soft (no provider, no crash) for an entity with neither installation nor connection', async () => {
    const f = fp()
    const d = discovery({
      installation: undefined,
      connection: undefined,
      repo: { owner: 'acme', name: 'billing' },
      proposal: { name: 'billing-svc' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.imported).toBe(true)
    expect(f.collections['apps'][0].repository).toMatchObject({ owner: 'acme', name: 'billing' })
    expect((f.collections['apps'][0].repository as Record<string, unknown>).provider).toBeUndefined()
  })

  it('ADO accept: an unresolvable connection (deleted/missing) fails soft — no crash, owner falls back to discovered repo.owner', async () => {
    const f = fp()
    // No git-connections seeded — connection id points nowhere.
    const d = discovery({
      installation: undefined,
      connection: 'conn-missing',
      repo: { owner: 'my-project', name: 'billing' },
      proposal: { name: 'billing-svc' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredService(payloadOf(f), d)

    expect(res.imported).toBe(true)
    const repo = f.collections['apps'][0].repository as Record<string, unknown>
    expect(repo.provider).toBeUndefined()
    expect(repo.owner).toBe('my-project')
  })
})

// --- pickNearestApp ----------------------------------------------------------

describe('pickNearestApp', () => {
  const monorepo = [
    { id: 'root', path: '' },
    { id: 'api', path: 'apps/api' },
  ]

  it('picks the nearest-ancestor app by longest path-segment prefix', () => {
    expect(pickNearestApp(monorepo, 'apps/api')).toBe('api')
    expect(pickNearestApp(monorepo, 'apps/api/docs')).toBe('api')
  })

  it('falls back to the root app when no deeper app is an ancestor', () => {
    expect(pickNearestApp(monorepo, 'apps/web-next')).toBe('root')
    expect(pickNearestApp(monorepo, '')).toBe('root')
  })

  it('respects segment boundaries — apps/api is not a prefix of apps/api2', () => {
    expect(pickNearestApp(monorepo, 'apps/api2')).toBe('root')
  })

  it('returns undefined when there is no ancestor and no root app', () => {
    expect(pickNearestApp([{ id: 'api', path: 'apps/api' }], 'apps/web-next')).toBeUndefined()
  })

  it('treats an absent/null path as the repo root', () => {
    expect(pickNearestApp([{ id: 'legacy' }], 'apps/api')).toBe('legacy')
    expect(pickNearestApp([{ id: 'legacy', path: null }], 'apps/api')).toBe('legacy')
  })

  it('picks the deepest among multiple ancestor apps', () => {
    const apps = [
      { id: 'root', path: '' },
      { id: 'apps', path: 'apps' },
      { id: 'api', path: 'apps/api' },
    ]
    expect(pickNearestApp(apps, 'apps/api/v1')).toBe('api')
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
      collectionSlug: 'api-schemas',
      docId: schemas[0].id,
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

  it('imports graphql proposals into api-schemas', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'graphql', specPath: 'schema.graphql', rawContent: 'type Query { a: String }' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d, { actorUserId: 'user-9' })

    expect(res.imported).toBe(true)
    const schemas = f.collections['api-schemas']
    expect(schemas).toHaveLength(1)
    expect(schemas[0]).toMatchObject({
      schemaType: 'graphql',
      rawContent: 'type Query { a: String }',
      repositoryPath: 'schema.graphql',
    })
    expect(f.collections['discovered-entities'][0].status).toBe('imported')
    expect(f.collections['discovered-entities'][0].importedRef).toEqual({
      collectionSlug: 'api-schemas',
      docId: schemas[0].id,
    })
  })

  it('SKIPS proposals with a genuinely unknown schema type', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      proposal: { schemaType: 'protobuf', specPath: 'schema.proto', rawContent: 'syntax = "proto3";' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res).toEqual({ imported: false, skippedReason: 'unsupported-schema-type:protobuf' })
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
      collectionSlug: 'api-schemas',
      docId: 'schema-existing',
    })
  })

  it('short-circuits when the row is already imported', async () => {
    const f = fp()
    const d = discovery({
      detectedKind: 'api',
      status: 'imported',
      importedRef: { collectionSlug: 'api-schemas', docId: 'schema-x' },
      proposal: { schemaType: 'openapi', specPath: 'openapi.yaml', rawContent: 'openapi: 3.0.0' },
    })

    const res = await importDiscoveredApi(payloadOf(f), d)

    expect(res).toEqual({ imported: true, ref: { collection: 'api-schemas', id: 'schema-x' } })
    expect(f.collections['api-schemas']).toHaveLength(0)
  })

  it('attaches a spec to the nearest-ancestor sub-app App, never another sub-app of the repo', async () => {
    const f = fp()
    f.collections['apps'] = [
      { id: 'app-web', workspace: 'ws1', repository: { owner: 'acme', name: 'billing', path: 'apps/web-next' } },
      { id: 'app-api', workspace: 'ws1', repository: { owner: 'acme', name: 'billing', path: 'apps/api' } },
    ]
    const d = discovery({
      detectedKind: 'api',
      path: 'apps/api',
      proposal: { schemaType: 'openapi', specPath: 'apps/api/openapi.json', rawContent: 'openapi: 3.0.0' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredApi(payloadOf(f), d, { actorUserId: 'user-1' })

    expect(res.imported).toBe(true)
    expect(f.collections['api-schemas'][0].repository).toBe('app-api')
  })

  it('ADO: links the repository rel by resolved org, not the raw discovered project owner', async () => {
    const f = fp()
    f.collections['git-connections'] = [{ id: 'conn-1', organization: 'my-ado-org' }]
    f.collections['apps'] = [
      {
        id: 'app-1',
        workspace: 'ws1',
        repository: { provider: 'azure-devops', connection: 'conn-1', owner: 'my-ado-org', project: 'my-project', name: 'billing' },
      },
    ]
    const d = discovery({
      detectedKind: 'api',
      installation: undefined,
      connection: 'conn-1',
      repo: { owner: 'my-project', name: 'billing' },
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
    expect(f.collections['api-schemas'][0]).toMatchObject({ repository: 'app-1' })
  })
})

// --- importDiscoveredGlobalEntity (WP8) -------------------------------------

describe('importDiscoveredGlobalEntity', () => {
  it('creates a global catalog entity (no workspace, source.type scan) for a service', async () => {
    const f = fp()
    const d = discovery({
      workspace: undefined,
      dedupeKey: 'globalkey123456',
      proposal: { name: 'billing', description: 'Billing', buildConfig: { language: 'go' } },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredGlobalEntity(payloadOf(f), d)

    expect(res.imported).toBe(true)
    expect(res.ref?.collection).toBe('catalog-entities')
    const entities = f.collections['catalog-entities']
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({
      name: 'billing',
      description: 'Billing',
      kind: 'service',
      source: { type: 'scan', sourceId: 'globalkey123456' },
    })
    // no workspace on the global entity
    expect(entities[0].workspace).toBeUndefined()
    // build details folded into metadata for a later assign-to-workspace re-import
    expect((entities[0].metadata as Record<string, unknown>).buildConfig).toEqual({ language: 'go' })
    expect((entities[0].metadata as Record<string, unknown>).repo).toMatchObject({ owner: 'acme', name: 'billing' })
    // no apps/api-schemas rows for a global import
    expect(f.collections['apps']).toHaveLength(0)
    const row = f.collections['discovered-entities'][0]
    expect(row.status).toBe('imported')
    expect(row.importedRef).toEqual({ collectionSlug: 'catalog-entities', docId: entities[0].id })
  })

  it('carries schemaType/specPath into metadata for a global api', async () => {
    const f = fp()
    const d = discovery({
      workspace: undefined,
      detectedKind: 'api',
      dedupeKey: 'apikey',
      proposal: { name: 'orders', schemaType: 'openapi', specPath: 'openapi.yaml' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredGlobalEntity(payloadOf(f), d)

    expect(res.imported).toBe(true)
    const entity = f.collections['catalog-entities'][0]
    expect(entity).toMatchObject({ kind: 'api' })
    expect((entity.metadata as Record<string, unknown>).schemaType).toBe('openapi')
    expect((entity.metadata as Record<string, unknown>).specPath).toBe('openapi.yaml')
  })

  it('is idempotent on (source.type, source.sourceId): links, never duplicates', async () => {
    const f = fp()
    const d = discovery({ workspace: undefined, dedupeKey: 'dupe', proposal: { name: 'svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    await importDiscoveredGlobalEntity(payloadOf(f), d)
    const linked = { ...f.collections['discovered-entities'][0] } as unknown as DiscoveredEntity
    await importDiscoveredGlobalEntity(payloadOf(f), linked)

    expect(f.collections['catalog-entities']).toHaveLength(1)
  })

  it('ADO: folds provider/connection/org/project into metadata.repo (catalog-entities has no dedicated provider field)', async () => {
    const f = fp()
    f.collections['git-connections'] = [{ id: 'conn-1', organization: 'my-ado-org' }]
    const d = discovery({
      workspace: undefined,
      installation: undefined,
      connection: 'conn-1',
      dedupeKey: 'adoglobalkey',
      repo: { owner: 'my-project', name: 'billing' },
      proposal: { name: 'billing' },
    })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscoveredGlobalEntity(payloadOf(f), d)

    expect(res.imported).toBe(true)
    const metadata = f.collections['catalog-entities'][0].metadata as Record<string, unknown>
    expect(metadata.repo).toMatchObject({
      provider: 'azure-devops',
      connection: 'conn-1',
      owner: 'my-ado-org',
      project: 'my-project',
      name: 'billing',
    })
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

  it('routes a workspace-less row to the global entity importer (WP8)', async () => {
    const f = fp()
    const d = discovery({ workspace: undefined, dedupeKey: 'gk', proposal: { name: 'svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscovery(payloadOf(f), d)

    expect(res.ref?.collection).toBe('catalog-entities')
    expect(f.collections['catalog-entities']).toHaveLength(1)
    expect(f.collections['apps']).toHaveLength(0)
  })

  it('assignWorkspaceId reassigns a global row and imports through the workspace path (WP8)', async () => {
    const f = fp()
    const d = discovery({ workspace: undefined, dedupeKey: 'gk', proposal: { name: 'svc' } })
    f.collections['discovered-entities'] = [{ ...d } as Doc]

    const res = await importDiscovery(payloadOf(f), d, { assignWorkspaceId: 'ws-target' })

    expect(res.ref?.collection).toBe('apps')
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['apps'][0].workspace).toBe('ws-target')
    expect(f.collections['catalog-entities'] ?? []).toHaveLength(0)
    expect(f.collections['discovered-entities'][0].workspace).toBe('ws-target')
  })
})
