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

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn((val: string) => `enc:${val}`),
}))

vi.mock('@/lib/github/octokit', () => ({
  getInstallation: vi.fn(),
  createInstallationToken: vi.fn(),
}))

vi.mock('@/lib/temporal/client', () => ({
  ensureGitHubTokenRefreshWorkflow: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { getInstallation, createInstallationToken } from '@/lib/github/octokit'
import { GITHUB_INSTALL_STATE_COOKIE } from '@/lib/github/install-state'

const { GET } = await import('./route')

type Doc = Record<string, unknown> & { id: string }

class FakePayload {
  collections: Record<string, Doc[]> = { 'github-installations': [], users: [] }
  created: Array<{ collection: string; data: unknown }> = []

  async find({ collection, where }: { collection: string; where?: Record<string, unknown> }) {
    let docs = this.collections[collection] ?? []
    const w = where as { installationId?: { equals: number }; email?: { equals: string } } | undefined
    if (collection === 'github-installations' && w?.installationId) {
      docs = docs.filter((d) => d.installationId === w.installationId!.equals)
    }
    if (collection === 'users' && w?.email) {
      docs = docs.filter((d) => d.email === w.email!.equals)
    }
    return { docs }
  }

  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    this.created.push({ collection, data })
    const doc = { id: `${collection}-new`, ...data }
    this.collections[collection] = [...(this.collections[collection] ?? []), doc]
    return doc
  }

  async update({ id, data }: { id: string; data: Record<string, unknown> }) {
    return { id, ...data }
  }
}

const p = (f: FakePayload) => f as unknown as Payload

function req(params: Record<string, string>, cookieValue?: string) {
  const url = new URL('http://localhost/api/github/installation/callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headersInit: Record<string, string> = {}
  if (cookieValue !== undefined) {
    headersInit['cookie'] = `${GITHUB_INSTALL_STATE_COOKIE}=${cookieValue}`
  }
  return new NextRequest(url, { headers: headersInit })
}

const adminUser = { id: 'user-1', email: 'admin@example.com', role: 'super_admin' }
const memberUser = { id: 'user-2', email: 'member@example.com', role: 'member' }

const installationApiResponse = {
  account: { login: 'acme-org', id: 999, type: 'Organization', avatar_url: 'https://avatar' },
  repository_selection: 'all',
}

function mockHappyGitHubApi() {
  vi.mocked(getInstallation).mockResolvedValue(installationApiResponse as any)
  vi.mocked(createInstallationToken).mockResolvedValue({
    token: 'tok',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  } as any)
}

describe('GET /api/github/installation/callback — CSRF state + auth (WI4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('valid state: cookie matches param → proceeds, creates the installation, clears the cookie', async () => {
    const f = new FakePayload()
    f.collections.users = [adminUser]
    vi.mocked(getPayload).mockResolvedValue(p(f))
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { email: adminUser.email } } as any)
    mockHappyGitHubApi()

    const request = req(
      { installation_id: '55555', setup_action: 'install', state: 'good-state' },
      'good-state',
    )
    const res = await GET(request)

    expect(res.headers.get('location')).toContain('/settings/connections')
    expect(res.headers.get('location')).not.toContain('error=')
    expect(f.created).toHaveLength(1)
    expect(f.created[0].collection).toBe('github-installations')
    expect(res.headers.get('set-cookie') ?? '').toContain(GITHUB_INSTALL_STATE_COOKIE)
  })

  it('state param present, cookie mismatch → rejects, no doc created, no session/payload lookups', async () => {
    const f = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(f))

    const request = req(
      { installation_id: '55555', setup_action: 'install', state: 'good-state' },
      'different-state',
    )
    const res = await GET(request)

    expect(res.headers.get('location')).toContain('/settings/connections?error=state_mismatch')
    expect(f.created).toHaveLength(0)
    expect(getPayload).not.toHaveBeenCalled()
    expect(auth.api.getSession).not.toHaveBeenCalled()
  })

  it('state param present, cookie absent → rejects, no doc created', async () => {
    const f = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(f))

    const request = req({ installation_id: '55555', setup_action: 'install', state: 'good-state' })
    const res = await GET(request)

    expect(res.headers.get('location')).toContain('/settings/connections?error=state_mismatch')
    expect(f.created).toHaveLength(0)
  })

  it('no state param + authenticated platform admin → proceeds as an unsolicited install and warns', async () => {
    const f = new FakePayload()
    f.collections.users = [adminUser]
    vi.mocked(getPayload).mockResolvedValue(p(f))
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { email: adminUser.email } } as any)
    mockHappyGitHubApi()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = req({ installation_id: '55555', setup_action: 'install' })
    const res = await GET(request)

    expect(res.headers.get('location')).toContain('/settings/connections')
    expect(res.headers.get('location')).not.toContain('error=')
    expect(f.created).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('no state param + no session → redirects to login, no doc created', async () => {
    const f = new FakePayload()
    vi.mocked(getPayload).mockResolvedValue(p(f))
    vi.mocked(auth.api.getSession).mockResolvedValue(null as any)

    const request = req({ installation_id: '55555', setup_action: 'install' })
    const res = await GET(request)

    expect(res.headers.get('location')).toContain('/login')
    expect(f.created).toHaveLength(0)
  })

  it('no state param + authenticated non-admin → rejects, no doc created', async () => {
    const f = new FakePayload()
    f.collections.users = [memberUser]
    vi.mocked(getPayload).mockResolvedValue(p(f))
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { email: memberUser.email } } as any)

    const request = req({ installation_id: '55555', setup_action: 'install' })
    const res = await GET(request)

    expect(res.headers.get('location')).toContain('/settings/connections?error=unauthorized')
    expect(f.created).toHaveLength(0)
  })
})
