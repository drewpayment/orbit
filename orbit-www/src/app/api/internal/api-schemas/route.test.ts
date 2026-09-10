/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
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

// --- helpers -----------------------------------------------------------------

function req(apiKey: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest('http://localhost/api/internal/api-schemas', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validBody = () => ({
  workspaceId: 'ws-1',
  userId: 'user-1',
  name: 'Orders API',
  schemaType: 'openapi',
  content: 'openapi: 3.1.0',
  description: 'desc',
  visibility: 'public',
  source: { type: 'scaffolder-run', sourceId: 'run-1' },
})

// --- FakePayload ---------------------------------------------------------------

type Doc = Record<string, unknown> & { id: string }

function getPath(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, doc)
}

class FakePayload {
  collections: Record<string, Doc[]> = {
    workspaces: [],
    'api-schemas': [],
    'api-schema-versions': [],
  }
  private counter = 1

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) {
      throw new Error('Not Found')
    }
    return doc
  }
  async find({ collection, where, limit }: { collection: string; where?: unknown; limit?: number }) {
    const all = this.collections[collection] ?? []
    const matchesClause = (d: Doc, clause: Record<string, unknown>): boolean => {
      if ('and' in clause) {
        return (clause.and as Array<Record<string, unknown>>).every((c) => matchesClause(d, c))
      }
      if ('or' in clause) {
        return (clause.or as Array<Record<string, unknown>>).some((c) => matchesClause(d, c))
      }
      const [field, cond] = Object.entries(clause)[0] as [string, Record<string, unknown>]
      if ('equals' in cond) return getPath(d, field) === cond.equals
      if ('contains' in cond) return String(getPath(d, field) ?? '').includes(String(cond.contains))
      return true
    }
    const docs = where ? all.filter((d) => matchesClause(d, where as Record<string, unknown>)) : all
    return { docs: typeof limit === 'number' ? docs.slice(0, limit) : docs }
  }
  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const doc = { id: `${collection}-${this.counter++}`, ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }
}

const p = (f: FakePayload) => f as unknown as Payload

function seedWorkspace(fp: FakePayload, overrides: Partial<Doc> = {}) {
  const doc: Doc = { id: 'ws-1', name: 'Acme', ...overrides }
  fp.collections.workspaces.push(doc)
  return doc
}

// --- tests ---------------------------------------------------------------------

describe('POST /api/internal/api-schemas', () => {
  it('returns 401 when X-API-Key is missing', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req(null, validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-API-Key is wrong', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('wrong-key', validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid JSON body', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const badReq = new NextRequest('http://localhost/api/internal/api-schemas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: '{not json',
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })

  it.each(['workspaceId', 'userId', 'name', 'schemaType', 'content'])(
    'returns 400 when %s is missing',
    async (field) => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const body = validBody() as Record<string, unknown>
      delete body[field]

      const res = await POST(req('test-api-key', body))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain(field)
    },
  )

  it('returns 400 when source is missing', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as Record<string, unknown>
    delete body.source

    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('source')
  })

  it.each(['type', 'sourceId'])('returns 400 when source.%s is missing', async (field) => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as { source: Record<string, unknown> }
    delete body.source[field]

    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain(`source.${field}`)
  })

  it('returns 400 for an unsupported schemaType', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', { ...validBody(), schemaType: 'asyncapi' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('schemaType')
  })

  it('accepts schemaType "proto"', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(
      req('test-api-key', { ...validBody(), schemaType: 'proto', content: 'syntax = "proto3";' }),
    )
    expect(res.status).toBe(201)
    const entity = fp.collections['api-schemas'][0]
    expect(entity.schemaType).toBe('proto')
  })

  it('returns 400 for an unsupported source.type', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(
      req('test-api-key', { ...validBody(), source: { type: 'not-a-real-source', sourceId: 'run-1' } }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('source.type')
  })

  it('returns 400 for an invalid visibility', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', { ...validBody(), visibility: 'everyone' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('visibility')
  })

  it('defaults visibility to "workspace" when omitted', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as Record<string, unknown>
    delete body.visibility

    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(201)
    expect(fp.collections['api-schemas'][0].visibility).toBe('workspace')
  })

  it('returns 422 (not 404 — reserved by the Go client for "route not implemented") for an unknown workspace id', async () => {
    const fp = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('workspace not found')
  })

  it('creates an api-schemas row and a v1 api-schema-versions row on the happy path', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(typeof json.schemaId).toBe('string')
    expect(typeof json.versionId).toBe('string')
    expect(typeof json.slug).toBe('string')

    const schema = fp.collections['api-schemas'].find((d) => d.id === json.schemaId)
    expect(schema).toBeDefined()
    expect(schema?.name).toBe('Orders API')
    expect(schema?.schemaType).toBe('openapi')
    expect(schema?.rawContent).toBe('openapi: 3.1.0')
    expect(schema?.workspace).toBe('ws-1')
    expect(schema?.visibility).toBe('public')
    expect(schema?.status).toBe('draft')
    expect(schema?.createdBy).toBe('user-1')
    expect((schema?.source as { type: string; sourceId: string }).type).toBe('scaffolder-run')
    expect((schema?.source as { type: string; sourceId: string }).sourceId).toBe('run-1')
    expect(schema?.slug).toBe('orders-api')

    const version = fp.collections['api-schema-versions'].find((d) => d.id === json.versionId)
    expect(version).toBeDefined()
    expect(version?.schema).toBe(json.schemaId)
    expect(version?.workspace).toBe('ws-1')
    expect(version?.versionNumber).toBe(1)
    expect(version?.rawContent).toBe('openapi: 3.1.0')
    expect(version?.createdBy).toBe('user-1')
  })

  it('is idempotent: a second call for the same workspace/source/name returns the existing schema with 200', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', validBody()))
    const second = await POST(req('test-api-key', validBody()))

    const firstJson = await first.json()
    const secondJson = await second.json()
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(secondJson.schemaId).toBe(firstJson.schemaId)
    expect(secondJson.versionId).toBe(firstJson.versionId)
    expect(secondJson.slug).toBe(firstJson.slug)
    expect(fp.collections['api-schemas']).toHaveLength(1)
    expect(fp.collections['api-schema-versions']).toHaveLength(1)
  })

  it('creates a second schema when the name differs for the same workspace/source', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', validBody()))
    const second = await POST(req('test-api-key', { ...validBody(), name: 'Billing API' }))

    const firstJson = await first.json()
    const secondJson = await second.json()
    expect(second.status).toBe(201)
    expect(firstJson.schemaId).not.toBe(secondJson.schemaId)
    expect(fp.collections['api-schemas']).toHaveLength(2)
  })

  it('de-duplicates the slug within the workspace for a substring collision (not an exact duplicate)', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    // "orders-api-legacy" contains the candidate base slug "orders-api" but is
    // neither the same slug nor the same name, so this is NOT the
    // already-registered case below — it's a plain slug-uniqueness collision,
    // which still gets a numeric suffix.
    fp.collections['api-schemas'].push({
      id: 'existing',
      workspace: 'ws-1',
      name: 'Orders API Legacy',
      slug: 'orders-api-legacy',
      source: { type: 'manual', sourceId: 'n/a' },
    } as Doc)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(201)
  })

  it('returns 409 ALREADY_EXISTS when another row already has the same canonical slug from a different run', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    fp.collections['api-schemas'].push({
      id: 'existing',
      workspace: 'ws-1',
      name: 'Some Other Name',
      slug: 'orders-api',
      source: { type: 'scaffolder-run', sourceId: 'run-0' },
    } as Doc)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('ALREADY_EXISTS')
    expect(json.error).toContain('orders-api')
    expect(json.slug).toBe('orders-api')
    expect(fp.collections['api-schemas']).toHaveLength(1)
  })

  it('returns 409 ALREADY_EXISTS when another row already has the same name from a different run', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    fp.collections['api-schemas'].push({
      id: 'existing',
      workspace: 'ws-1',
      name: 'Orders API',
      slug: 'orders-api-renamed',
      source: { type: 'scaffolder-run', sourceId: 'run-0' },
    } as Doc)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('ALREADY_EXISTS')
    expect(fp.collections['api-schemas']).toHaveLength(1)
  })

  it('does NOT 409 when the matching row belongs to the same run but a different name (same-run idempotency stays scoped by name)', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    fp.collections['api-schemas'].push({
      id: 'existing',
      workspace: 'ws-1',
      name: 'Some Other Name',
      slug: 'orders-api',
      source: { type: 'scaffolder-run', sourceId: 'run-1' },
    } as Doc)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    // validBody() uses sourceId 'run-1' — same run as the seeded row, but a
    // different name/slug, so this must NOT be treated as an already-existing
    // duplicate; it should get a de-duplicated slug and succeed.
    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(201)
  })

  it('is idempotent even when a same-run row collides on slug (retry path takes priority over the conflict check)', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', validBody()))
    const firstJson = await first.json()
    expect(first.status).toBe(201)

    // Retried by Temporal: identical workspace/source/name — must still
    // return the existing row, not 409.
    const second = await POST(req('test-api-key', validBody()))
    expect(second.status).toBe(200)
    const secondJson = await second.json()
    expect(secondJson.schemaId).toBe(firstJson.schemaId)
  })
})
