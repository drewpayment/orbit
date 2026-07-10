import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

// ado-repos-core resolves credentials through token-core, which imports
// lib/encryption at module load. Stub it so no real ENCRYPTION_KEY is needed.
vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted:${val}`),
}))

import {
  listConnectionRepositoriesCore,
  adoRepositoriesUrl,
  type AdoFetch,
} from './ado-repos-core'
import { clearEntraTokenCache } from './token-core'

// --- FakePayload -------------------------------------------------------------

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
const decryptStub = (v: string) => `decrypted:${v}`

const patConn = (over: Partial<Doc> = {}): Doc => ({
  id: 'conn-1',
  provider: 'azure-devops',
  organization: 'acme',
  project: 'platform',
  baseUrl: 'https://dev.azure.com',
  authType: 'pat',
  credentials: { pat: 'enc-pat' },
  ...over,
})

/** A minimal ADO git-repositories REST payload. */
function reposBody(repos: Array<Record<string, unknown>>) {
  return { count: repos.length, value: repos }
}

function jsonResponse(status: number, body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('adoRepositoriesUrl', () => {
  it('builds the project-scoped repositories URL', () => {
    expect(adoRepositoriesUrl('https://dev.azure.com', 'acme', 'platform')).toBe(
      'https://dev.azure.com/acme/platform/_apis/git/repositories?api-version=7.1',
    )
  })

  it('trims a trailing slash and encodes segments', () => {
    expect(adoRepositoriesUrl('https://dev.azure.com/', 'acme corp', 'My Project')).toBe(
      'https://dev.azure.com/acme%20corp/My%20Project/_apis/git/repositories?api-version=7.1',
    )
  })
})

describe('listConnectionRepositoriesCore', () => {
  beforeEach(() => {
    clearEntraTokenCache()
  })

  it('lists repos for a project-scoped PAT connection with Basic auth', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [patConn()]

    const seen: Array<{ url: string; auth: string }> = []
    const fetchFn: AdoFetch = async (url, init) => {
      seen.push({ url, auth: init.headers.Authorization })
      return jsonResponse(
        200,
        reposBody([
          { name: 'backend', defaultBranch: 'refs/heads/main', isDisabled: false },
          { name: 'frontend', defaultBranch: 'refs/heads/develop' },
        ]),
      )
    }

    const res = await listConnectionRepositoriesCore(p(f), 'conn-1', { fetchFn, decryptFn: decryptStub })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.repos).toEqual([
      {
        name: 'backend',
        fullName: 'platform/backend',
        description: null,
        private: true,
        defaultBranch: 'main',
        project: 'platform',
      },
      {
        name: 'frontend',
        fullName: 'platform/frontend',
        description: null,
        private: true,
        defaultBranch: 'develop',
        project: 'platform',
      },
    ])
    // Single project-scoped call; Basic auth with empty username + PAT.
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(
      'https://dev.azure.com/acme/platform/_apis/git/repositories?api-version=7.1',
    )
    expect(seen[0].auth).toBe(`Basic ${Buffer.from(':decrypted:enc-pat').toString('base64')}`)
  })

  it('filters out disabled repos', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [patConn()]
    const fetchFn: AdoFetch = async () =>
      jsonResponse(
        200,
        reposBody([
          { name: 'live', defaultBranch: 'refs/heads/main', isDisabled: false },
          { name: 'dead', defaultBranch: 'refs/heads/main', isDisabled: true },
        ]),
      )

    const res = await listConnectionRepositoriesCore(p(f), 'conn-1', { fetchFn, decryptFn: decryptStub })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.repos.map((r) => r.name)).toEqual(['live'])
  })

  it('fans in across all projects when the connection has no project', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [patConn({ project: '' })]

    const urls: string[] = []
    const fetchFn: AdoFetch = async (url) => {
      urls.push(url)
      if (url.includes('/_apis/projects')) {
        return jsonResponse(200, { count: 2, value: [{ name: 'alpha' }, { name: 'beta' }] })
      }
      if (url.includes('/alpha/_apis/git/repositories')) {
        return jsonResponse(200, reposBody([{ name: 'a-repo', defaultBranch: 'refs/heads/main' }]))
      }
      return jsonResponse(200, reposBody([{ name: 'b-repo', defaultBranch: 'refs/heads/trunk' }]))
    }

    const res = await listConnectionRepositoriesCore(p(f), 'conn-1', { fetchFn, decryptFn: decryptStub })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.repos.map((r) => `${r.project}/${r.name}`)).toEqual(['alpha/a-repo', 'beta/b-repo'])
    expect(urls[0]).toContain('/_apis/projects')
  })

  it('uses Bearer auth for a service-principal connection', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [
      patConn({
        id: 'conn-sp',
        authType: 'service-principal',
        credentials: { tenantId: 't', clientId: 'c', clientSecret: 'enc-secret' },
      }),
    ]
    let authHeader = ''
    const fetchFn: AdoFetch = async (_url, init) => {
      authHeader = init.headers.Authorization
      return jsonResponse(200, reposBody([{ name: 'x', defaultBranch: 'refs/heads/main' }]))
    }
    const mintFn = vi.fn(async () => ({ token: 'entra-token', expiresAtMs: Date.now() + 3_600_000 }))

    const res = await listConnectionRepositoriesCore(p(f), 'conn-sp', {
      fetchFn,
      decryptFn: decryptStub,
      mintFn,
    })
    expect(res.ok).toBe(true)
    expect(authHeader).toBe('Bearer entra-token')
    expect(mintFn).toHaveBeenCalledTimes(1)
  })

  it('maps a credential-resolution failure to an error (never throws)', async () => {
    const f = new FakePayload()
    // No such connection.
    const res = await listConnectionRepositoriesCore(p(f), 'missing', {
      fetchFn: async () => jsonResponse(200, reposBody([])),
      decryptFn: decryptStub,
    })
    expect(res).toMatchObject({ ok: false })
    if (res.ok) return
    expect(res.error).toBeTruthy()
  })

  it('maps a non-2xx ADO response to an auth-style error and never leaks the token', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [patConn()]
    const fetchFn: AdoFetch = async () => jsonResponse(401, { message: 'unauthorized' })
    const res = await listConnectionRepositoriesCore(p(f), 'conn-1', { fetchFn, decryptFn: decryptStub })
    expect(res).toMatchObject({ ok: false })
    if (res.ok) return
    expect(res.error).toMatch(/auth|401/i)
    expect(res.error).not.toContain('enc-pat')
    expect(res.error).not.toContain('decrypted')
  })

  it('maps a network throw to an error', async () => {
    const f = new FakePayload()
    f.collections['git-connections'] = [patConn()]
    const fetchFn: AdoFetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    const res = await listConnectionRepositoriesCore(p(f), 'conn-1', { fetchFn, decryptFn: decryptStub })
    expect(res).toMatchObject({ ok: false })
  })
})
