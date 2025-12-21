/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('ORBIT_REGISTRY_JWT_SECRET', 'test-secret-key-for-jwt-signing-min-32-chars')

const { GET } = await import('./route')
const { generatePullToken } = await import('@/lib/registry-auth')

describe('GET /api/registry/token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without authorization', async () => {
    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:ws/app:pull&service=orbit-registry'
    )

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('returns 401 with invalid token', async () => {
    const credentials = Buffer.from('orbit-pull:invalid-token').toString('base64')
    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:ws/app:pull&service=orbit-registry',
      {
        headers: { Authorization: `Basic ${credentials}` },
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('returns 403 when scope does not match token', async () => {
    const token = await generatePullToken({
      workspaceSlug: 'my-workspace',
      appSlug: 'my-app',
    })
    const credentials = Buffer.from(`orbit-pull:${token}`).toString('base64')

    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:other-workspace/other-app:pull&service=orbit-registry',
      {
        headers: { Authorization: `Basic ${credentials}` },
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('returns Docker token for valid request', async () => {
    const token = await generatePullToken({
      workspaceSlug: 'my-workspace',
      appSlug: 'my-app',
    })
    const credentials = Buffer.from(`orbit-pull:${token}`).toString('base64')

    const request = new Request(
      'http://localhost/api/registry/token?scope=repository:my-workspace/my-app:pull&service=orbit-registry',
      {
        headers: { Authorization: `Basic ${credentials}` },
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.token).toBeTruthy()
    expect(data.expires_in).toBe(3600)
    expect(data.issued_at).toBeTruthy()
  })
})
