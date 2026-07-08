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

// The route imports token-core, which imports lib/encryption at module load —
// stub it so no real ENCRYPTION_KEY is needed and decrypt is deterministic.
vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => {
    if (val === 'corrupt') throw new Error('bad ciphertext')
    return `decrypted:${val}`
  }),
}))

vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')

import { getPayload } from 'payload'
const { POST } = await import('./route')
const { resolveConnectionToken } = await import('@/lib/connections/token-core')

function req(apiKey: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest('http://localhost/api/internal/git-connections/token', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = { 'git-connections': [] }
  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`findByID: ${collection}/${id} not found`)
    return doc
  }
}

const p = (f: FakePayload) => f as unknown as Payload

const conn = (over: Partial<Doc> = {}): Doc => ({
  id: 'conn-1',
  provider: 'azure-devops',
  organization: 'acme',
  project: 'platform',
  baseUrl: 'https://dev.azure.com',
  credentials: { pat: 'enc-pat' },
  ...over,
})

describe('POST /api/internal/git-connections/token — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const f = new FakePayload()
    f.collections['git-connections'] = [conn()]
    vi.mocked(getPayload).mockResolvedValue(p(f))
  })

  it('returns 401 without an API key', async () => {
    const res = await POST(req(null, { connectionId: 'conn-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 with the wrong API key', async () => {
    const res = await POST(req('wrong', { connectionId: 'conn-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when connectionId is missing', async () => {
    const res = await POST(req('test-api-key', {}))
    expect(res.status).toBe(400)
  })

  it('returns the decrypted PAT and coordinates for a valid connection', async () => {
    const res = await POST(req('test-api-key', { connectionId: 'conn-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      provider: 'azure-devops',
      organization: 'acme',
      project: 'platform',
      baseUrl: 'https://dev.azure.com',
      pat: 'decrypted:enc-pat',
    })
  })

  it('returns 404 for an unknown connection', async () => {
    const res = await POST(req('test-api-key', { connectionId: 'nope' }))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('NOT_FOUND')
  })
})

describe('resolveConnectionToken', () => {
  const decryptStub = (val: string) => {
    if (val === 'corrupt') throw new Error('bad ciphertext')
    return `decrypted:${val}`
  }

  it('defaults an empty baseUrl to https://dev.azure.com and empty project to ""', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [conn({ baseUrl: '', project: undefined })]
    const res = await resolveConnectionToken(p(f), 'conn-1', decryptStub)
    expect(res).toEqual({
      ok: true,
      body: {
        provider: 'azure-devops',
        organization: 'acme',
        project: '',
        baseUrl: 'https://dev.azure.com',
        pat: 'decrypted:enc-pat',
      },
    })
  })

  it('returns 404 when the connection is missing', async () => {
    const f = new FakePayload()
    const res = await resolveConnectionToken(p(f), 'missing', decryptStub)
    expect(res).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' })
  })

  it('returns 410 when the connection has no PAT stored', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [conn({ credentials: {} })]
    const res = await resolveConnectionToken(p(f), 'conn-1', decryptStub)
    expect(res).toMatchObject({ ok: false, status: 410, code: 'NOT_CONFIGURED' })
  })

  it('returns 500 when the PAT cannot be decrypted', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [conn({ credentials: { pat: 'corrupt' } })]
    const res = await resolveConnectionToken(p(f), 'conn-1', decryptStub)
    expect(res).toMatchObject({ ok: false, status: 500, code: 'DECRYPT_FAILED' })
  })
})
