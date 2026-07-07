/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Payload } from 'payload'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')

import { getPayload } from 'payload'
const { POST } = await import('./route')
const { ingestScan } = await import('@/lib/discovery/ingest')

// --- helpers -----------------------------------------------------------------

function req(apiKey: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest('http://localhost/api/internal/discovery/ingest', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validBody = () => ({
  installationId: '42',
  workspaceId: 'ws1',
  repo: { owner: 'acme', name: 'billing', url: 'https://github.com/acme/billing', defaultBranch: 'main' },
  scanRunId: 'run-1',
  bundle: { tree: ['README.md'], files: {} },
})

// --- FakePayload (for ingestScan core) --------------------------------------

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    apps: [],
    'api-schemas': [],
    'discovered-entities': [],
  }
  private counter = 1

  async find({ collection, where, limit = 100 }: { collection: string; where?: unknown; limit?: number }) {
    const all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    return { docs: all.slice(0, limit), hasNextPage: false }
  }
  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const doc = { id: `${collection}-${this.counter++}`, ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }
  async update({ collection, id, data }: { collection: string; id: string; data: Record<string, unknown> }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
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
    }
  }
  return true
}

const p = (f: FakePayload) => f as unknown as Payload

// --- bundles -----------------------------------------------------------------

const orbitManifest = `apiVersion: orbit.dev/v1
kind: Application
metadata:
  name: billing-service
  description: Handles billing
`

/** A repo declaring itself via .orbit.yaml -> Tier 1 auto-import. */
const tier1Bundle = () => ({
  tree: ['.orbit.yaml'],
  files: { '.orbit.yaml': orbitManifest },
})

/** A repo with an OpenAPI spec -> Tier 2 proposal. */
const apiBundle = () => ({
  tree: ['openapi.yaml'],
  files: {
    'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: Billing API\n  version: 1.0.0\npaths: {}\n',
  },
})

/** A repo with just a go.mod -> heuristic service proposal at root. */
const heuristicServiceBundle = () => ({
  tree: ['go.mod', 'Dockerfile'],
  files: { 'go.mod': 'module github.com/acme/billing\n' },
})

// --- POST: auth + validation -------------------------------------------------

describe('POST /api/internal/discovery/ingest — auth & validation', () => {
  const mockPayload = new FakePayload()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPayload).mockResolvedValue(p(mockPayload))
  })

  it('returns 401 without an API key', async () => {
    const res = await POST(req(null, validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 401 with the wrong API key', async () => {
    const res = await POST(req('wrong-key', validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 400 on a malformed body (missing repo.name)', async () => {
    const bad = { ...validBody(), repo: { owner: 'acme' } }
    const res = await POST(req('test-api-key', bad))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the bundle is missing', async () => {
    const bad = { installationId: '42', workspaceId: 'ws1', repo: { owner: 'acme', name: 'billing' } }
    const res = await POST(req('test-api-key', bad))
    expect(res.status).toBe(400)
  })

  it('returns 200 with counts for a valid empty scan', async () => {
    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ proposed: 0, imported: 0, skippedIgnored: 0 })
  })

  it('accepts a global-scan body with no workspaceId (WP8)', async () => {
    const { workspaceId: _omit, ...global } = validBody()
    void _omit
    const res = await POST(req('test-api-key', global))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ proposed: 0, imported: 0, skippedIgnored: 0 })
  })

  it('tolerates the optional truncation bundle fields the Go scanner sends', async () => {
    // WP4 contract: bundle may carry skippedLarge/truncatedTree/truncatedSelection —
    // the route must ignore, not reject, these extras.
    const body = {
      ...validBody(),
      bundle: {
        tree: ['README.md'],
        files: {},
        skippedLarge: 3,
        truncatedTree: true,
        truncatedSelection: false,
      },
    }
    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ proposed: 0, imported: 0, skippedIgnored: 0 })
  })
})

// --- ingestScan: dedupe / no-resurrect / Tier-1 matrix ----------------------

describe('ingestScan', () => {
  const body = (over: Partial<ReturnType<typeof validBody>> = {}) => ({ ...validBody(), ...over })

  it('creates a new proposed row for a heuristic service detection', async () => {
    const f = new FakePayload()
    const counts = await ingestScan(p(f), body({ bundle: heuristicServiceBundle() }))

    expect(counts).toEqual({ proposed: 1, imported: 0, skippedIgnored: 0 })
    const rows = f.collections['discovered-entities']
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ detectedKind: 'service', status: 'proposed', path: '' })
    // handoff note 2: heuristic root service name normalized to the repo name
    // (go.mod module basename here is already 'billing', but assert the repo name)
    expect((rows[0].proposal as Record<string, unknown>).name).toBe('billing')
    expect(rows[0].dedupeKey).toMatch(/^[0-9a-f]{40}$/)
  })

  it('normalizes a fallen-back root service name (literal "service") to the repo name', async () => {
    const f = new FakePayload()
    // Dockerfile only -> detectService yields name 'service' at root.
    await ingestScan(p(f), body({ bundle: { tree: ['Dockerfile'], files: {} } }))
    const row = f.collections['discovered-entities'][0]
    expect((row.proposal as Record<string, unknown>).name).toBe('billing')
  })

  it('auto-imports a Tier-1 .orbit.yaml detection and keeps a traceability row', async () => {
    const f = new FakePayload()
    const counts = await ingestScan(p(f), body({ bundle: tier1Bundle() }))

    expect(counts).toEqual({ proposed: 0, imported: 1, skippedIgnored: 0 })
    // App created via the import lib
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['apps'][0]).toMatchObject({
      name: 'billing-service',
      origin: { type: 'discovered' },
    })
    // discovery row kept for traceability, linked
    const row = f.collections['discovered-entities'][0]
    expect(row.status).toBe('imported')
    expect(row.importedRef).toEqual({ collection: 'apps', id: f.collections['apps'][0].id })
  })

  it('creates an api proposal (not auto-imported) for an OpenAPI spec', async () => {
    const f = new FakePayload()
    const counts = await ingestScan(p(f), body({ bundle: apiBundle() }))

    expect(counts).toEqual({ proposed: 1, imported: 0, skippedIgnored: 0 })
    expect(f.collections['api-schemas']).toHaveLength(0) // approval happens later
    const row = f.collections['discovered-entities'][0]
    expect(row).toMatchObject({ detectedKind: 'api', status: 'proposed' })
  })

  it('is idempotent on re-scan: refreshes scanRunId/lastSeenAt, no duplicate rows (AC-4)', async () => {
    const f = new FakePayload()
    await ingestScan(p(f), body({ bundle: apiBundle(), scanRunId: 'run-1' }))

    await ingestScan(p(f), body({ bundle: apiBundle(), scanRunId: 'run-2' }))

    expect(f.collections['discovered-entities']).toHaveLength(1)
    const row = f.collections['discovered-entities'][0]
    expect(row.scanRunId).toBe('run-2') // refreshed to the latest scan run
    expect(typeof row.lastSeenAt).toBe('string')
  })

  it('never resurrects an ignored row — refreshes bookkeeping only, counts skippedIgnored', async () => {
    const f = new FakePayload()
    // First scan creates the proposed row, then a member ignores it.
    await ingestScan(p(f), body({ bundle: apiBundle() }))
    const row = f.collections['discovered-entities'][0]
    row.status = 'ignored'
    row.scanRunId = 'run-1'

    const counts = await ingestScan(p(f), body({ bundle: apiBundle(), scanRunId: 'run-2' }))

    expect(counts).toEqual({ proposed: 0, imported: 0, skippedIgnored: 1 })
    const after = f.collections['discovered-entities'][0]
    expect(after.status).toBe('ignored') // still ignored
    expect(after.scanRunId).toBe('run-2') // liveness refreshed
    expect(f.collections['discovered-entities']).toHaveLength(1)
  })

  it('refreshes an already-imported Tier-1 row without re-creating the App (AC-4/AC-5)', async () => {
    const f = new FakePayload()
    await ingestScan(p(f), body({ bundle: tier1Bundle(), scanRunId: 'run-1' }))
    expect(f.collections['apps']).toHaveLength(1)
    const appName = f.collections['apps'][0].name
    // hand-edit the imported App
    f.collections['apps'][0].name = 'RENAMED'

    const counts = await ingestScan(p(f), body({ bundle: tier1Bundle(), scanRunId: 'run-2' }))

    expect(counts).toEqual({ proposed: 0, imported: 1, skippedIgnored: 0 })
    expect(f.collections['apps']).toHaveLength(1)
    expect(f.collections['apps'][0].name).toBe('RENAMED') // edit survived
    expect(appName).toBe('billing-service')
    expect(f.collections['discovered-entities'][0].scanRunId).toBe('run-2')
  })

  it('reports mixed counts across service + api + ignored detections in one scan', async () => {
    const f = new FakePayload()
    // Seed an ignored api row so this scan re-observes it.
    const bundle = {
      tree: ['.orbit.yaml', 'openapi.yaml', 'docs/asyncapi.yaml'],
      files: {
        '.orbit.yaml': orbitManifest,
        'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: A\n  version: 1.0.0\npaths: {}\n',
        'docs/asyncapi.yaml': 'asyncapi: 2.6.0\ninfo:\n  title: B\n  version: 1.0.0\nchannels: {}\n',
      },
    }
    await ingestScan(p(f), body({ bundle }))
    // Ignore the asyncapi proposal.
    const asyncRow = f.collections['discovered-entities'].find(
      (r) => (r.proposal as Record<string, unknown>).specPath === 'docs/asyncapi.yaml',
    )!
    asyncRow.status = 'ignored'

    const counts = await ingestScan(p(f), body({ bundle }))

    // Tier-1 service imported, openapi proposed, asyncapi skipped-ignored.
    expect(counts).toEqual({ proposed: 1, imported: 1, skippedIgnored: 1 })
  })

  it('creates workspace-less proposals for a global scan (no workspaceId) (WP8)', async () => {
    const f = new FakePayload()
    // Omit workspaceId entirely — a global (platform-admin) scan.
    const { workspaceId: _omit, ...global } = body({ bundle: heuristicServiceBundle() })
    void _omit

    const counts = await ingestScan(p(f), global as Parameters<typeof ingestScan>[1])

    expect(counts).toEqual({ proposed: 1, imported: 0, skippedIgnored: 0 })
    const row = f.collections['discovered-entities'][0]
    expect(row.workspace).toBeUndefined() // global row, no workspace
    expect(row.status).toBe('proposed')
  })

  it('auto-imports a Tier-1 global scan as a global catalog entity (WP8)', async () => {
    const f = new FakePayload()
    const { workspaceId: _omit, ...global } = body({ bundle: tier1Bundle() })
    void _omit

    const counts = await ingestScan(p(f), global as Parameters<typeof ingestScan>[1])

    expect(counts).toEqual({ proposed: 0, imported: 1, skippedIgnored: 0 })
    // Global import writes a catalog-entities row directly — no apps row.
    expect(f.collections['apps'] ?? []).toHaveLength(0)
    const entities = f.collections['catalog-entities'] ?? []
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ kind: 'service', source: { type: 'scan' } })
    const row = f.collections['discovered-entities'][0]
    expect(row.status).toBe('imported')
    expect((row.importedRef as { collection: string }).collection).toBe('catalog-entities')
  })

  it('resolves the numeric installationId to the github-installations doc id for the relationship', async () => {
    const f = new FakePayload()
    f.collections['github-installations'] = [{ id: 'inst-doc-1', installationId: 42 }]

    await ingestScan(p(f), body({ bundle: heuristicServiceBundle() }))

    // The relation must carry the Payload doc id, never the raw numeric GitHub id
    // (writing '42' into a relationship field fails Mongo's ObjectId cast).
    expect(f.collections['discovered-entities'][0].installation).toBe('inst-doc-1')
  })

  it('leaves the installation relation unset when no github-installations doc matches', async () => {
    const f = new FakePayload()

    await ingestScan(p(f), body({ bundle: heuristicServiceBundle() }))

    expect(f.collections['discovered-entities'][0].installation).toBeUndefined()
  })
})
