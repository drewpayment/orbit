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

function req(apiKey: string | null, id: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest(`http://localhost/api/internal/templates/${id}/finalize`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const validBody = () => ({
  workspaceId: 'ws-1',
  repoUrl: 'https://github.com/acme/orders',
  repoName: 'orders-service',
})

// --- FakePayload ---------------------------------------------------------------

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = {
    templates: [],
    'catalog-entities': [],
  }
  private counter = 1

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) {
      const err = new Error(`Not Found`)
      throw err
    }
    return doc
  }
  async find({ collection, where }: { collection: string; where?: unknown }) {
    const all = this.collections[collection] ?? []
    // Only used for slug-collision lookups in this route; keep it simple.
    const w = where as { and?: Array<Record<string, unknown>> } | undefined
    if (!w?.and) return { docs: all }
    return {
      docs: all.filter((d) =>
        w.and!.every((clause) => {
          const [field, cond] = Object.entries(clause)[0] as [string, Record<string, unknown>]
          if ('equals' in cond) return d[field] === cond.equals
          if ('contains' in cond) return String(d[field] ?? '').includes(String(cond.contains))
          return true
        }),
      ),
    }
  }
  async update({ collection, id, data }: { collection: string; id: string; data: Record<string, unknown> }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`update: ${collection}/${id} not found`)
    Object.assign(doc, data)
    return doc
  }
  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const doc = { id: `${collection}-${this.counter++}`, ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }
}

const p = (f: FakePayload) => f as unknown as Payload

function seedTemplate(fp: FakePayload, overrides: Partial<Doc> = {}) {
  const doc: Doc = { id: 'tpl-1', name: 'Node Service', usageCount: 0, ...overrides }
  fp.collections.templates.push(doc)
  return doc
}

// --- tests ---------------------------------------------------------------------

describe('POST /api/internal/templates/[id]/finalize', () => {
  it('returns 401 when X-API-Key is missing', async () => {
    const fp = new FakePayload()
    seedTemplate(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req(null, 'tpl-1', validBody()), ctx('tpl-1'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-API-Key is wrong', async () => {
    const fp = new FakePayload()
    seedTemplate(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('wrong-key', 'tpl-1', validBody()), ctx('tpl-1'))
    expect(res.status).toBe(401)
  })

  it.each(['workspaceId', 'repoUrl', 'repoName'])('returns 400 when %s is missing', async (field) => {
    const fp = new FakePayload()
    seedTemplate(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as Record<string, unknown>
    delete body[field]

    const res = await POST(req('test-api-key', 'tpl-1', body), ctx('tpl-1'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain(field)
  })

  it('returns 404 for an unknown template id', async () => {
    const fp = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', 'does-not-exist', validBody()), ctx('does-not-exist'))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('template not found')
  })

  it('increments usageCount and creates a catalog entity on the happy path', async () => {
    const fp = new FakePayload()
    seedTemplate(fp, { id: 'tpl-1', usageCount: 3 })
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', 'tpl-1', validBody()), ctx('tpl-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.usageCount).toBe(4)
    expect(typeof json.catalogEntityId).toBe('string')

    expect(fp.collections.templates[0].usageCount).toBe(4)

    const entity = fp.collections['catalog-entities'].find((d) => d.id === json.catalogEntityId)
    expect(entity).toBeDefined()
    expect(entity?.name).toBe('orders-service')
    expect(entity?.kind).toBe('service')
    expect(entity?.workspace).toBe('ws-1')
    expect((entity?.source as { type: string; sourceId: string }).type).toBe('template')
    expect((entity?.source as { type: string; sourceId: string }).sourceId).toBe('tpl-1')
    expect(entity?.links).toEqual([{ label: 'Repository', url: 'https://github.com/acme/orders', type: 'repository' }])
  })

  it('treats usageCount undefined on the template as 0', async () => {
    const fp = new FakePayload()
    seedTemplate(fp, { id: 'tpl-1', usageCount: undefined })
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', 'tpl-1', validBody()), ctx('tpl-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.usageCount).toBe(1)
  })

  it('is not idempotent: two calls create two catalog entities and increment usageCount twice', async () => {
    // Temporal activity retries could double-call this route (Risk 4 in the
    // Phase 0 plan); documented as a known follow-up, not a regression here.
    const fp = new FakePayload()
    seedTemplate(fp, { id: 'tpl-1', usageCount: 0 })
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', 'tpl-1', validBody()), ctx('tpl-1'))
    const second = await POST(req('test-api-key', 'tpl-1', validBody()), ctx('tpl-1'))

    const firstJson = await first.json()
    const secondJson = await second.json()
    expect(firstJson.usageCount).toBe(1)
    expect(secondJson.usageCount).toBe(2)
    expect(firstJson.catalogEntityId).not.toBe(secondJson.catalogEntityId)
    expect(fp.collections['catalog-entities']).toHaveLength(2)
  })
})
