import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'

// connections-core imports lib/encryption at module load for the default
// decrypt; stub it so no real ENCRYPTION_KEY is needed. Tests inject decrypt.
vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted:${val}`),
}))

import {
  toAdminConnectionView,
  listConnectionsAdminCore,
  createConnectionCore,
  updateConnectionCore,
  deleteConnectionCore,
  validateConnectionCore,
  adoProjectsUrl,
  type ValidateFetch,
} from './connections-core'

// --- FakePayload -------------------------------------------------------------

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = { 'git-connections': [] }
  private counter = 1

  async find({ collection, sort }: { collection: string; sort?: string }) {
    let docs = [...(this.collections[collection] ?? [])]
    if (sort) docs = docs.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')))
    return { docs, hasNextPage: false }
  }
  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`findByID: ${collection}/${id} not found`)
    return doc
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
  async delete({ collection, id }: { collection: string; id: string }) {
    const list = this.collections[collection] ?? []
    const idx = list.findIndex((d) => d.id === id)
    if (idx === -1) throw new Error(`delete: ${collection}/${id} not found`)
    const [doc] = list.splice(idx, 1)
    return doc
  }
}

const p = (f: FakePayload) => f as unknown as Payload
const decryptStub = (v: string) => `decrypted:${v}`

// --- toAdminConnectionView / list -------------------------------------------

describe('toAdminConnectionView', () => {
  it('projects a PAT-less view and reports patSet=true when a PAT is stored', () => {
    const view = toAdminConnectionView({
      id: 'c1',
      name: 'Acme ADO',
      provider: 'azure-devops',
      organization: 'acme',
      project: 'platform',
      baseUrl: 'https://dev.azure.com',
      status: 'active',
      credentials: { pat: 'enc' },
      allowedWorkspaces: [{ id: 'ws1', name: 'Payments' }],
      updatedAt: '2026-07-07T00:00:00.000Z',
    })
    expect(view.patSet).toBe(true)
    expect(view.allowedWorkspaces).toEqual([{ id: 'ws1', name: 'Payments' }])
    // No PAT anywhere in the projected view.
    expect(JSON.stringify(view)).not.toContain('enc')
    expect((view as Record<string, unknown>).credentials).toBeUndefined()
  })

  it('reports patSet=false and defaults baseUrl when no PAT/baseUrl set', () => {
    const view = toAdminConnectionView({ id: 'c1', name: 'x', organization: 'acme' })
    expect(view.patSet).toBe(false)
    expect(view.baseUrl).toBe('https://dev.azure.com')
    expect(view.project).toBe('')
  })
})

describe('listConnectionsAdminCore', () => {
  it('lists connections as PAT-less views', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [
      { id: 'c1', name: 'B', organization: 'b', credentials: { pat: 'enc' } },
      { id: 'c2', name: 'A', organization: 'a' },
    ]
    const views = await listConnectionsAdminCore(p(f))
    expect(views.map((v) => v.name)).toEqual(['A', 'B'])
    expect(views.every((v) => (v as Record<string, unknown>).credentials === undefined)).toBe(true)
  })
})

// --- create ------------------------------------------------------------------

describe('createConnectionCore', () => {
  it('rejects an empty name or organization', async () => {
    const f = new FakePayload()
    expect((await createConnectionCore(p(f), { name: '', organization: 'acme' })).ok).toBe(false)
    expect((await createConnectionCore(p(f), { name: 'x', organization: '  ' })).ok).toBe(false)
    expect(f.collections['git-connections']).toHaveLength(0)
  })

  it('creates with defaults and stores the PAT under credentials', async () => {
    const f = new FakePayload()
    const res = await createConnectionCore(p(f), {
      name: 'Acme',
      organization: 'acme',
      pat: 'secret-pat',
    })
    expect(res.ok).toBe(true)
    const doc = f.collections['git-connections'][0]
    expect(doc).toMatchObject({
      name: 'Acme',
      provider: 'azure-devops',
      organization: 'acme',
      project: '',
      baseUrl: 'https://dev.azure.com',
      status: 'active',
      credentials: { pat: 'secret-pat' },
    })
  })

  it('omits credentials entirely when no PAT is supplied', async () => {
    const f = new FakePayload()
    await createConnectionCore(p(f), { name: 'Acme', organization: 'acme' })
    expect(f.collections['git-connections'][0].credentials).toBeUndefined()
  })
})

// --- update (write-only PAT) -------------------------------------------------

describe('updateConnectionCore', () => {
  it('keeps the stored PAT when none is supplied (write-only edit)', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [
      { id: 'c1', name: 'Acme', organization: 'acme', credentials: { pat: 'old-enc' } },
    ]
    const res = await updateConnectionCore(p(f), { id: 'c1', name: 'Acme Renamed' })
    expect(res.ok).toBe(true)
    const doc = f.collections['git-connections'][0]
    expect(doc.name).toBe('Acme Renamed')
    expect(doc.credentials).toEqual({ pat: 'old-enc' }) // untouched
  })

  it('replaces the PAT when a new one is supplied', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [
      { id: 'c1', name: 'Acme', organization: 'acme', credentials: { pat: 'old-enc' } },
    ]
    await updateConnectionCore(p(f), { id: 'c1', pat: 'new-plain' })
    expect(f.collections['git-connections'][0].credentials).toEqual({ pat: 'new-plain' })
  })

  it('rejects clearing a required field', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [{ id: 'c1', name: 'Acme', organization: 'acme' }]
    expect((await updateConnectionCore(p(f), { id: 'c1', organization: '' })).ok).toBe(false)
  })

  it('returns not-found for a missing connection', async () => {
    const f = new FakePayload()
    expect((await updateConnectionCore(p(f), { id: 'nope', name: 'x' })).ok).toBe(false)
  })
})

describe('deleteConnectionCore', () => {
  it('deletes an existing connection', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [{ id: 'c1', name: 'Acme', organization: 'acme' }]
    const res = await deleteConnectionCore(p(f), 'c1')
    expect(res.ok).toBe(true)
    expect(f.collections['git-connections']).toHaveLength(0)
  })
  it('returns not-found for a missing connection', async () => {
    const f = new FakePayload()
    expect((await deleteConnectionCore(p(f), 'nope')).ok).toBe(false)
  })
})

// --- validate ----------------------------------------------------------------

describe('adoProjectsUrl', () => {
  it('builds the projects probe url and trims trailing slashes', () => {
    expect(adoProjectsUrl('https://dev.azure.com/', 'acme')).toBe(
      'https://dev.azure.com/acme/_apis/projects?api-version=7.1',
    )
  })
})

describe('validateConnectionCore', () => {
  const conn = () => ({
    id: 'c1',
    name: 'Acme',
    organization: 'acme',
    baseUrl: 'https://dev.azure.com',
    credentials: { pat: 'enc-pat' },
  })

  it('marks the connection active on a 200 and records lastValidatedAt', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [conn()]
    const fetchFn: ValidateFetch = vi.fn(async (url, init) => {
      // PAT basic auth header, empty username.
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(':decrypted:enc-pat').toString('base64')}`)
      expect(url).toBe('https://dev.azure.com/acme/_apis/projects?api-version=7.1')
      return { status: 200 }
    })
    const res = await validateConnectionCore(p(f), 'c1', { fetchFn, decryptFn: decryptStub })
    expect(res).toMatchObject({ ok: true, status: 'active' })
    const doc = f.collections['git-connections'][0]
    expect(doc.status).toBe('active')
    expect(typeof doc.lastValidatedAt).toBe('string')
    expect(doc.lastError).toBeNull()
  })

  it('marks the connection error with an auth message on a 401', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [conn()]
    const fetchFn: ValidateFetch = vi.fn(async () => ({ status: 401 }))
    const res = await validateConnectionCore(p(f), 'c1', { fetchFn, decryptFn: decryptStub })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/Authentication failed/)
    expect(f.collections['git-connections'][0].status).toBe('error')
    expect(f.collections['git-connections'][0].lastError).toMatch(/Authentication failed/)
  })

  it('marks error when the connection has no PAT stored', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [{ ...conn(), credentials: {} }]
    const fetchFn: ValidateFetch = vi.fn(async () => ({ status: 200 }))
    const res = await validateConnectionCore(p(f), 'c1', { fetchFn, decryptFn: decryptStub })
    expect(res.ok).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(f.collections['git-connections'][0].status).toBe('error')
  })

  it('marks error when the provider is unreachable', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [conn()]
    const fetchFn: ValidateFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const res = await validateConnectionCore(p(f), 'c1', { fetchFn, decryptFn: decryptStub })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Could not reach/)
  })

  it('returns not-found for a missing connection without persisting', async () => {
    const f = new FakePayload()
    const fetchFn: ValidateFetch = vi.fn(async () => ({ status: 200 }))
    const res = await validateConnectionCore(p(f), 'nope', { fetchFn, decryptFn: decryptStub })
    expect(res).toMatchObject({ ok: false, status: 'error', error: 'Connection not found' })
  })
})
