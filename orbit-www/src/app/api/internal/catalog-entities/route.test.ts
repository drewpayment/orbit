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
  return new NextRequest('http://localhost/api/internal/catalog-entities', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validBody = () => ({
  workspaceId: 'ws-1',
  kind: 'service',
  name: 'orders-service',
  owner: 'team-payments',
  links: [{ title: 'Repository', url: 'https://github.com/acme/orders' }],
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
    'catalog-entities': [],
    'template-definitions': [],
    'template-definition-versions': [],
  }
  /** Every `findByID` call's collection, in order — used to assert lookups were (not) made. */
  findByIDCalls: string[] = []
  private counter = 1

  async findByID({ collection, id }: { collection: string; id: string }) {
    this.findByIDCalls.push(collection)
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) {
      throw new Error('Not Found')
    }
    return doc
  }
  async find({ collection, where }: { collection: string; where?: unknown }) {
    const all = this.collections[collection] ?? []
    const w = where as { and?: Array<Record<string, unknown>> } | undefined
    if (!w?.and) return { docs: all }
    return {
      docs: all.filter((d) =>
        w.and!.every((clause) => {
          const [field, cond] = Object.entries(clause)[0] as [string, Record<string, unknown>]
          if ('equals' in cond) return getPath(d, field) === cond.equals
          if ('contains' in cond) return String(getPath(d, field) ?? '').includes(String(cond.contains))
          return true
        }),
      ),
    }
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

describe('POST /api/internal/catalog-entities', () => {
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

    const badReq = new NextRequest('http://localhost/api/internal/catalog-entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: '{not json',
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })

  it.each(['workspaceId', 'kind', 'name'])('returns 400 when %s is missing', async (field) => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as Record<string, unknown>
    delete body[field]

    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain(field)
  })

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

  it('returns 400 for an unknown kind', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', { ...validBody(), kind: 'not-a-real-kind' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('kind')
  })

  it('returns 400 for an unknown source.type', async () => {
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

  it('returns 422 (not 404 — reserved by the Go client for "route not implemented") for an unknown workspace id', async () => {
    const fp = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('workspace not found')
  })

  it('creates a catalog entity on the happy path', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(typeof json.entityId).toBe('string')

    const entity = fp.collections['catalog-entities'].find((d) => d.id === json.entityId)
    expect(entity).toBeDefined()
    expect(entity?.name).toBe('orders-service')
    expect(entity?.kind).toBe('service')
    expect(entity?.workspace).toBe('ws-1')
    expect((entity?.source as { type: string; sourceId: string }).type).toBe('scaffolder-run')
    expect((entity?.source as { type: string; sourceId: string }).sourceId).toBe('run-1')
    expect(entity?.links).toEqual([
      { label: 'Repository', url: 'https://github.com/acme/orders', type: 'other' },
    ])
    expect(entity?.slug).toBe('orders-service')
  })

  it('omits links when none are provided', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as Record<string, unknown>
    delete body.links

    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(201)
    const entity = fp.collections['catalog-entities'][0]
    expect(entity.links).toBeUndefined()
  })

  it('is idempotent: a second call for the same workspace/source/name returns the existing entity', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', validBody()))
    const second = await POST(req('test-api-key', validBody()))

    const firstJson = await first.json()
    const secondJson = await second.json()
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(firstJson.entityId).toBe(secondJson.entityId)
    expect(fp.collections['catalog-entities']).toHaveLength(1)
  })

  it('creates a second entity when the name differs for the same workspace/source', async () => {
    const fp = new FakePayload()
    seedWorkspace(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', validBody()))
    const second = await POST(req('test-api-key', { ...validBody(), name: 'orders-worker' }))

    const firstJson = await first.json()
    const secondJson = await second.json()
    expect(firstJson.entityId).not.toBe(secondJson.entityId)
    expect(fp.collections['catalog-entities']).toHaveLength(2)
  })

  describe('template provenance', () => {
    function seedTemplateDefinition(fp: FakePayload, overrides: Partial<Doc> = {}) {
      const doc: Doc = { id: 'tmpl-1', workspace: 'ws-1', status: 'published', ...overrides }
      fp.collections['template-definitions'].push(doc)
      return doc
    }

    function seedTemplateVersion(fp: FakePayload, overrides: Partial<Doc> = {}) {
      const doc: Doc = { id: 'tmpl-1-v2', definition: 'tmpl-1', ...overrides }
      fp.collections['template-definition-versions'].push(doc)
      return doc
    }

    it('stores sourceTemplateDefinition/sourceTemplateVersion when both belong to the workspace/definition', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      seedTemplateDefinition(fp)
      seedTemplateVersion(fp)
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(
        req('test-api-key', {
          ...validBody(),
          templateDefinitionId: 'tmpl-1',
          templateVersionId: 'tmpl-1-v2',
        }),
      )
      expect(res.status).toBe(201)
      const json = await res.json()
      const entity = fp.collections['catalog-entities'].find((d) => d.id === json.entityId)
      expect(
        (entity?.source as { sourceTemplateDefinition?: string }).sourceTemplateDefinition,
      ).toBe('tmpl-1')
      expect((entity?.source as { sourceTemplateVersion?: string }).sourceTemplateVersion).toBe(
        'tmpl-1-v2',
      )
    })

    it('returns 422 when templateDefinitionId does not exist', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(
        req('test-api-key', { ...validBody(), templateDefinitionId: 'nope' }),
      )
      expect(res.status).toBe(422)
      expect(fp.collections['catalog-entities']).toHaveLength(0)
    })

    it('returns 422 when templateDefinitionId belongs to a different workspace', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      seedTemplateDefinition(fp, { workspace: 'ws-2' })
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(
        req('test-api-key', { ...validBody(), templateDefinitionId: 'tmpl-1' }),
      )
      expect(res.status).toBe(422)
      expect(fp.collections['catalog-entities']).toHaveLength(0)
    })

    it('returns 422 when templateVersionId does not exist', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      seedTemplateDefinition(fp)
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(
        req('test-api-key', {
          ...validBody(),
          templateDefinitionId: 'tmpl-1',
          templateVersionId: 'nope',
        }),
      )
      expect(res.status).toBe(422)
      expect(fp.collections['catalog-entities']).toHaveLength(0)
    })

    it('returns 422 when templateVersionId does not belong to templateDefinitionId', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      seedTemplateDefinition(fp)
      seedTemplateDefinition(fp, { id: 'tmpl-2' })
      seedTemplateVersion(fp, { definition: 'tmpl-2' })
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(
        req('test-api-key', {
          ...validBody(),
          templateDefinitionId: 'tmpl-1',
          templateVersionId: 'tmpl-1-v2',
        }),
      )
      expect(res.status).toBe(422)
      expect(fp.collections['catalog-entities']).toHaveLength(0)
    })

    it('returns 400 when templateVersionId is given without templateDefinitionId', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(
        req('test-api-key', { ...validBody(), templateVersionId: 'tmpl-1-v2' }),
      )
      expect(res.status).toBe(400)
    })

    it('omits sourceTemplateDefinition/sourceTemplateVersion and skips both lookups when the ids are not provided', async () => {
      const fp = new FakePayload()
      seedWorkspace(fp)
      vi.mocked(getPayload).mockResolvedValue(p(fp))

      const res = await POST(req('test-api-key', validBody()))
      expect(res.status).toBe(201)
      const json = await res.json()
      const entity = fp.collections['catalog-entities'].find((d) => d.id === json.entityId)
      expect(
        (entity?.source as { sourceTemplateDefinition?: string }).sourceTemplateDefinition,
      ).toBeUndefined()
      expect(
        (entity?.source as { sourceTemplateVersion?: string }).sourceTemplateVersion,
      ).toBeUndefined()
      expect(fp.findByIDCalls).not.toContain('template-definitions')
      expect(fp.findByIDCalls).not.toContain('template-definition-versions')
    })
  })
})
