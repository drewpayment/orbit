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
const { GET } = await import('./route')

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = { apps: [] }
  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) {
      const err = new Error(`not found`) as Error & { status?: number }
      err.status = 404
      throw err
    }
    return doc
  }
}

const p = (f: FakePayload) => f as unknown as Payload

function req(apiKey: string | null) {
  const headers: Record<string, string> = {}
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest('http://localhost/api/internal/workspaces/ws-1/apps/app-1', { headers })
}

const ctx = (id: string, appId: string) => ({ params: Promise.resolve({ id, appId }) })

describe('GET /api/internal/workspaces/[id]/apps/[appId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without a valid API key', async () => {
    const f = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(f))
    const res = await GET(req(null), ctx('ws-1', 'app-1'))
    expect(res.status).toBe(401)
  })

  it('emits provider, connectionId and project for an Azure DevOps app', async () => {
    const f = new FakePayload()
    f.collections.apps = [
      {
        id: 'app-1',
        name: 'backend',
        workspace: 'ws-1',
        repository: {
          provider: 'azure-devops',
          owner: 'acme',
          project: 'platform',
          name: 'backend',
          url: 'https://dev.azure.com/acme/platform/_git/backend',
          connection: 'conn-1',
          branch: 'main',
        },
      },
    ]
    vi.mocked(getPayload).mockResolvedValue(p(f))

    const res = await GET(req('test-api-key'), ctx('ws-1', 'app-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.repository).toMatchObject({
      provider: 'azure-devops',
      owner: 'acme',
      project: 'platform',
      name: 'backend',
      url: 'https://dev.azure.com/acme/platform/_git/backend',
      connectionId: 'conn-1',
      branch: 'main',
    })
  })

  it('emits empty provider fields for a legacy GitHub app', async () => {
    const f = new FakePayload()
    f.collections.apps = [
      {
        id: 'app-1',
        name: 'gh-app',
        workspace: 'ws-1',
        repository: {
          owner: 'acme',
          name: 'gh-app',
          url: 'https://github.com/acme/gh-app',
          installationId: 'install-1',
          branch: 'main',
        },
      },
    ]
    vi.mocked(getPayload).mockResolvedValue(p(f))

    const res = await GET(req('test-api-key'), ctx('ws-1', 'app-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.repository.provider).toBe('')
    expect(body.repository.connectionId).toBe('')
    expect(body.repository.project).toBe('')
    expect(body.repository.owner).toBe('acme')
  })

  it('returns 404 when the app belongs to another workspace', async () => {
    const f = new FakePayload()
    f.collections.apps = [
      { id: 'app-1', name: 'x', workspace: 'ws-other', repository: { url: 'u' } },
    ]
    vi.mocked(getPayload).mockResolvedValue(p(f))

    const res = await GET(req('test-api-key'), ctx('ws-1', 'app-1'))
    expect(res.status).toBe(404)
  })
})
