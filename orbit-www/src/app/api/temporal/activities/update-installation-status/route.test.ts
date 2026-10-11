/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ findByID: vi.fn(), update: vi.fn() }))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ findByID: mocks.findByID, update: mocks.update })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')

const { POST } = await import('./route')

function req(apiKey: string | null, body: unknown = { installationId: 'i1', status: 'active' }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return new NextRequest('http://localhost/api/temporal/activities/update-installation-status', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/temporal/activities/update-installation-status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockResolvedValue({})
  })

  it('returns 401 without an API key and does not write', async () => {
    const res = await POST(req(null))
    expect(res.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong API key and does not write', async () => {
    const res = await POST(req('wrong'))
    expect(res.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('updates the installation with a valid API key', async () => {
    const res = await POST(req('test-api-key'))
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'github-installations', id: 'i1' }),
    )
  })
})
