/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  findByID: vi.fn(),
  update: vi.fn(),
  signal: vi.fn(),
  terminate: vi.fn(),
  startWorkflow: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ findByID: mocks.findByID, update: mocks.update })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/lib/authz', async () => (await import('@/lib/authz/route-test-utils')).makeAuthzMock(mocks))
vi.mock('@/lib/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => ({
    workflow: { getHandle: () => ({ signal: mocks.signal, terminate: mocks.terminate }) },
  })),
  startGitHubTokenRefreshWorkflow: mocks.startWorkflow,
}))

import { FakeAuthzError, FakeUnauthenticatedError } from '@/lib/authz/route-test-utils'

const ctx = { params: Promise.resolve({ id: 'inst-1' }) }
const post = (name: string) =>
  new NextRequest(`http://localhost/api/github/installations/inst-1/${name}`, { method: 'POST' })

const routes = {
  refresh: await import('./refresh/route'),
  'restart-workflow': await import('./restart-workflow/route'),
  'retry-workflow': await import('./retry-workflow/route'),
}

describe.each(Object.keys(routes) as Array<keyof typeof routes>)('POST /api/github/installations/[id]/%s', (name) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ isPlatformAdmin: true })
    mocks.findByID.mockResolvedValue({
      id: 'inst-1',
      temporalWorkflowStatus: name === 'retry-workflow' ? 'failed' : 'running',
      temporalWorkflowId: 'wf-1',
    })
    mocks.startWorkflow.mockResolvedValue('wf-2')
    mocks.update.mockResolvedValue({})
  })

  it('returns 401 when unauthenticated, with no side effects', async () => {
    mocks.authorize.mockRejectedValue(new FakeUnauthenticatedError())
    const res = await routes[name].POST(post(name), ctx)
    expect(res.status).toBe(401)
    expect(mocks.findByID).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
    expect(mocks.terminate).not.toHaveBeenCalled()
    expect(mocks.startWorkflow).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-platform-admin, with no side effects', async () => {
    mocks.authorize.mockRejectedValue(new FakeAuthzError())
    const res = await routes[name].POST(post(name), ctx)
    expect(res.status).toBe(403)
    expect(mocks.findByID).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
    expect(mocks.terminate).not.toHaveBeenCalled()
    expect(mocks.startWorkflow).not.toHaveBeenCalled()
  })

  it('succeeds for a platform admin', async () => {
    const res = await routes[name].POST(post(name), ctx)
    expect(res.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith('manage', { kind: 'platform' })
  })
})
