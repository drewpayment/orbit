/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// server-only throws if imported outside an RSC bundle; stub it for the test.
vi.mock('server-only', () => ({}))

const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/session', () => ({ getCurrentUser }))

// Capture what the interceptor asks the minter to sign.
const mintServiceToken = vi.fn(async () => 'signed-token')
vi.mock('./svc-auth-token', () => ({ mintServiceToken }))

// Avoid pulling the real Payload config/runtime into the node test env. These
// are only reached on the workspace-scoped path, which these tests do not take.
vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

async function runInterceptor(user: unknown, message: unknown = {}) {
  getCurrentUser.mockResolvedValue(user)
  const { authInterceptor } = await import('./auth-interceptor')
  const next = vi.fn(async () => 'response')
  const req = { message, header: new Headers() }
  // Interceptor shape: (next) => async (req) => ...
  await authInterceptor(next as never)(req as never)
  return { next, req }
}

describe('authInterceptor platform-admin derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('signs adm:true for a super_admin session user', async () => {
    await runInterceptor({ id: 'u1', role: 'super_admin' })
    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: true })
  })

  it('signs adm:true for an admin session user', async () => {
    await runInterceptor({ id: 'u1', role: 'admin' })
    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: true })
  })

  it('does not elevate a plain user', async () => {
    await runInterceptor({ id: 'u1', role: 'user' })
    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: false })
  })

  it('ignores an admin role smuggled in the request message (no self-elevation)', async () => {
    await runInterceptor({ id: 'u1', role: 'user' }, { role: 'super_admin', adm: true })
    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: false })
  })

  it('throws when there is no authenticated user', async () => {
    getCurrentUser.mockResolvedValue(null)
    const { authInterceptor } = await import('./auth-interceptor')
    const next = vi.fn(async () => 'response')
    const req = { message: {}, header: new Headers() }
    await expect(authInterceptor(next as never)(req as never)).rejects.toThrow(/no authenticated user/)
    expect(mintServiceToken).not.toHaveBeenCalled()
  })
})
