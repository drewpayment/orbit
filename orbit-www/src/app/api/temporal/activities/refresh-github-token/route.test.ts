/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  findByID: vi.fn(),
  update: vi.fn(),
  createInstallationToken: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ findByID: mocks.findByID, update: mocks.update })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/github/octokit', () => ({ createInstallationToken: mocks.createInstallationToken }))
vi.mock('@/lib/encryption', () => ({ encrypt: (v: string) => `enc:${v}` }))
vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')

const { POST } = await import('./route')

function req(apiKey: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest('http://localhost/api/temporal/activities/refresh-github-token', {
    method: 'POST',
    headers,
    body: JSON.stringify({ installationId: 'i1' }),
  })
}

describe('POST /api/temporal/activities/refresh-github-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findByID.mockResolvedValue({ id: 'i1', installationId: 42 })
    mocks.createInstallationToken.mockResolvedValue({ token: 't', expiresAt: new Date('2030-01-01') })
    mocks.update.mockResolvedValue({})
  })

  it('returns 401 without an API key and mints/persists nothing', async () => {
    const res = await POST(req(null))
    expect(res.status).toBe(401)
    expect(mocks.createInstallationToken).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong API key', async () => {
    const res = await POST(req('wrong'))
    expect(res.status).toBe(401)
    expect(mocks.createInstallationToken).not.toHaveBeenCalled()
  })

  it('refreshes the token with a valid API key', async () => {
    const res = await POST(req('test-api-key'))
    expect(res.status).toBe(200)
    expect((await res.json()).Success).toBe(true)
    expect(mocks.update).toHaveBeenCalled()
  })
})
