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
  return new NextRequest('http://localhost/api/internal/kafka-topics', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validBody = () => ({
  workspaceId: 'ws-1',
  virtualClusterId: 'vc-1',
  name: 'orders',
  owner: 'team-payments',
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
    'kafka-virtual-clusters': [],
    'kafka-applications': [],
    'kafka-topics': [],
  }
  private counter = 1

  async findByID({ collection, id }: { collection: string; id: string }) {
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

// Defaults to direct ownership by ws-1, matching validBody()'s workspaceId,
// with a topicPrefix so fullTopicName / physicalName assertions are exact.
function seedVirtualCluster(fp: FakePayload, overrides: Partial<Doc> = {}) {
  const doc: Doc = {
    id: 'vc-1',
    name: 'primary',
    workspace: 'ws-1',
    topicPrefix: 'dev-acme-',
    ...overrides,
  }
  fp.collections['kafka-virtual-clusters'].push(doc)
  return doc
}

function seedApplication(fp: FakePayload, overrides: Partial<Doc> = {}) {
  const doc: Doc = { id: 'app-1', name: 'orders-app', workspace: 'ws-1', ...overrides }
  fp.collections['kafka-applications'].push(doc)
  return doc
}

// --- tests ---------------------------------------------------------------------

describe('POST /api/internal/kafka-topics', () => {
  it('returns 401 when X-API-Key is missing', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req(null, validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-API-Key is wrong', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('wrong-key', validBody()))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid JSON body', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const badReq = new NextRequest('http://localhost/api/internal/kafka-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-api-key' },
      body: '{not json',
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })

  it.each(['workspaceId', 'virtualClusterId', 'name'])('returns 400 when %s is missing', async (field) => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const body = validBody() as Record<string, unknown>
    delete body[field]

    const res = await POST(req('test-api-key', body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain(field)
  })

  it('returns 404 for an unknown virtual cluster id', async () => {
    const fp = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.code).toBe('NOT_FOUND')
  })

  it('returns 404 when the virtual cluster is directly owned by a different workspace', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp, { workspace: 'ws-other' })
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.code).toBe('NOT_FOUND')
    expect(fp.collections['kafka-topics']).toHaveLength(0)
  })

  it('returns 404 when a legacy application-owned cluster belongs to a different workspace', async () => {
    const fp = new FakePayload()
    seedApplication(fp, { id: 'app-1', workspace: 'ws-other' })
    seedVirtualCluster(fp, { workspace: undefined, application: 'app-1' })
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.code).toBe('NOT_FOUND')
  })

  it('creates a kafka topic on the happy path', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(typeof json.id).toBe('string')
    expect(json.status).toBe('provisioning')
    expect(json.partitions).toBe(3)
    expect(json.topicPrefix).toBe('dev-acme-')
    expect(json.fullTopicName).toBe('dev-acme-orders')

    const topic = fp.collections['kafka-topics'].find((d) => d.id === json.id)
    expect(topic).toBeDefined()
    expect(topic?.workspace).toBe('ws-1')
    expect(topic?.virtualCluster).toBe('vc-1')
    expect(topic?.environment).toBe('dev')
    expect(topic?.replicationFactor).toBe(3)
    expect(topic?.approvalRequired).toBe(false)
    expect(topic?.fullTopicName).toBe('dev-acme-orders')
    expect(topic?.tags).toEqual([{ tag: 'owner:team-payments' }])
  })

  it('resolves ownership and topicPrefix through a legacy application-owned cluster', async () => {
    const fp = new FakePayload()
    seedApplication(fp, { id: 'app-1', workspace: 'ws-1' })
    seedVirtualCluster(fp, { workspace: undefined, application: 'app-1', topicPrefix: 'legacy-' })
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(req('test-api-key', validBody()))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.topicPrefix).toBe('legacy-')
    expect(json.fullTopicName).toBe('legacy-orders')
  })

  it('honours custom partitions, retentionMs, and environment', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const res = await POST(
      req('test-api-key', {
        ...validBody(),
        partitions: 12,
        retentionMs: 86400000,
        environment: 'staging',
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.partitions).toBe(12)

    const topic = fp.collections['kafka-topics'].find((d) => d.id === json.id)
    expect(topic?.retentionMs).toBe(86400000)
    expect(topic?.environment).toBe('staging')
  })

  it('is idempotent on (workspace, virtualCluster, name)', async () => {
    const fp = new FakePayload()
    seedVirtualCluster(fp)
    vi.mocked(getPayload).mockResolvedValue(p(fp))

    const first = await POST(req('test-api-key', validBody()))
    expect(first.status).toBe(201)
    const firstJson = await first.json()

    const second = await POST(req('test-api-key', validBody()))
    expect(second.status).toBe(200)
    const secondJson = await second.json()

    expect(secondJson.id).toBe(firstJson.id)
    expect(fp.collections['kafka-topics']).toHaveLength(1)
  })
})
