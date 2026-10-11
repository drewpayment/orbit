/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), find: vi.fn() }))

vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ find: mocks.find })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', async () => (await import('@/lib/authz/route-test-utils')).makeAuthzMock(mocks))

import { FakeAuthzError, FakeUnauthenticatedError } from '@/lib/authz/route-test-utils'

const { GET } = await import('./route')

describe('GET /api/github/installations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({})
    mocks.find.mockResolvedValue({
      docs: [{ id: 'i1', accountLogin: 'acme', installationToken: 'ciphertext' }],
      totalDocs: 1,
    })
  })

  it('401 / 403 without reading', async () => {
    mocks.authorize.mockRejectedValueOnce(new FakeUnauthenticatedError())
    expect((await GET()).status).toBe(401)
    mocks.authorize.mockRejectedValueOnce(new FakeAuthzError())
    expect((await GET()).status).toBe(403)
    expect(mocks.find).not.toHaveBeenCalled()
  })

  it('returns installations without token ciphertext, keeping pagination fields', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalDocs).toBe(1)
    expect(json.docs[0].accountLogin).toBe('acme')
    expect(JSON.stringify(json)).not.toContain('ciphertext')
    expect(json.docs[0]).not.toHaveProperty('installationToken')
  })
})
