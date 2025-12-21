/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.stubEnv('ORBIT_INTERNAL_API_KEY', 'test-api-key')
vi.stubEnv('ORBIT_REGISTRY_JWT_SECRET', 'test-secret-key-for-jwt-signing-min-32-chars')
vi.stubEnv('ORBIT_REGISTRY_URL', 'registry.orbit.local:5050')

// Import after mocking env
import { getPayload } from 'payload'
const { POST } = await import('./route')

describe('POST /api/internal/registry/pull-token', () => {
  const mockPayload = {
    findByID: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
  })

  it('returns 401 without API key', async () => {
    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      body: JSON.stringify({ appId: 'test-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('returns 401 with wrong API key', async () => {
    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'wrong-key' },
      body: JSON.stringify({ appId: 'test-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('returns 400 without appId', async () => {
    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 404 if app not found', async () => {
    mockPayload.findByID.mockResolvedValue(null)

    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ appId: 'nonexistent-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(404)
  })

  it('returns pull credentials for valid app', async () => {
    mockPayload.findByID.mockResolvedValue({
      id: 'test-app',
      slug: 'my-app',
      workspace: {
        id: 'ws-123',
        slug: 'my-workspace',
      },
    })

    const request = new Request('http://localhost/api/internal/registry/pull-token', {
      method: 'POST',
      headers: { 'X-API-Key': 'test-api-key' },
      body: JSON.stringify({ appId: 'test-app' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.username).toBe('orbit-pull')
    expect(data.password).toBeTruthy()
    expect(data.registry).toBe('registry.orbit.local:5050')
    expect(data.expiresAt).toBeTruthy()
  })
})
