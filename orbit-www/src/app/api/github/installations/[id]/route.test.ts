/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  findByID: vi.fn(),
  update: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ findByID: mocks.findByID, update: mocks.update })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', async () => (await import('@/lib/authz/route-test-utils')).makeAuthzMock(mocks))

import { FakeAuthzError, FakeUnauthenticatedError } from '@/lib/authz/route-test-utils'

const { GET, PATCH } = await import('./route')

const W1 = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const W2 = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ctx = { params: Promise.resolve({ id: 'inst-1' }) }
const doc = {
  id: 'inst-1',
  accountLogin: 'acme',
  installationToken: 'ciphertext-secret',
  allowedWorkspaces: [],
}

function patch(body: unknown) {
  return new NextRequest('http://localhost/api/github/installations/inst-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const get = () => new NextRequest('http://localhost/api/github/installations/inst-1')

describe('/api/github/installations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ isPlatformAdmin: true })
    mocks.findByID.mockResolvedValue({ ...doc })
    mocks.update.mockImplementation(async ({ data }: { data: object }) => ({ ...doc, ...data }))
  })

  it('GET returns 401 when unauthenticated and never reads the doc', async () => {
    mocks.authorize.mockRejectedValue(new FakeUnauthenticatedError())
    const res = await GET(get(), ctx)
    expect(res.status).toBe(401)
    expect(mocks.findByID).not.toHaveBeenCalled()
  })

  it('GET returns 403 for a non-platform-admin', async () => {
    mocks.authorize.mockRejectedValue(new FakeAuthzError())
    const res = await GET(get(), ctx)
    expect(res.status).toBe(403)
    expect(mocks.findByID).not.toHaveBeenCalled()
  })

  it('GET returns the installation WITHOUT the token ciphertext for a platform admin', async () => {
    const res = await GET(get(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accountLogin).toBe('acme')
    expect(body).not.toHaveProperty('installationToken')
  })

  it('GET returns 404 when the installation does not exist', async () => {
    mocks.findByID.mockRejectedValue(new Error('Not Found'))
    const res = await GET(get(), ctx)
    expect(res.status).toBe(404)
  })

  it('PATCH returns 401/403 without touching the doc', async () => {
    mocks.authorize.mockRejectedValueOnce(new FakeUnauthenticatedError())
    expect((await PATCH(patch({ allowedWorkspaces: [W1] }), ctx)).status).toBe(401)
    mocks.authorize.mockRejectedValueOnce(new FakeAuthzError())
    expect((await PATCH(patch({ allowedWorkspaces: [W1] }), ctx)).status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('PATCH updates allowedWorkspaces for a platform admin and strips the token from the response', async () => {
    const res = await PATCH(patch({ allowedWorkspaces: [W1, W2] }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inst-1', data: { allowedWorkspaces: [W1, W2] } }),
    )
    expect(await res.json()).not.toHaveProperty('installationToken')
  })

  it('PATCH returns 404 when the installation does not exist', async () => {
    mocks.findByID.mockRejectedValue(new Error('Not Found'))
    expect((await PATCH(patch({ allowedWorkspaces: [W1] }), ctx)).status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('PATCH maps a Payload ValidationError to 400 (not 404)', async () => {
    mocks.update.mockRejectedValue(Object.assign(new Error('invalid'), { name: 'ValidationError' }))
    expect((await PATCH(patch({ allowedWorkspaces: [W1] }), ctx)).status).toBe(400)
  })

  it('PATCH maps an unexpected update failure to 500', async () => {
    mocks.update.mockRejectedValue(new Error('db down'))
    expect((await PATCH(patch({ allowedWorkspaces: [W1] }), ctx)).status).toBe(500)
  })

  it.each([
    [{ installationToken: 'attacker' }],
    [{ status: 'active' }],
    [{ allowedWorkspaces: [W1], installationToken: 'attacker' }],
    [{ allowedWorkspaces: W1 }],
    [{ allowedWorkspaces: ['not-an-id'] }],
    [{ allowedWorkspaces: ['../etc'] }],
    [{ allowedWorkspaces: [1] }],
    [{}],
    [null],
  ])('PATCH rejects disallowed body %j with 400', async (body) => {
    const res = await PATCH(patch(body), ctx)
    expect(res.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
