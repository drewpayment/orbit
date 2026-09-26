/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// server-only throws if imported outside an RSC bundle; stub it for the test.
vi.mock('server-only', () => ({}))

// The interceptor resolves the Actor (Payload-backed role) and, for
// workspace-scoped RPCs, membership via workspaceRole (no admin bypass).
const getActor = vi.fn()
const workspaceRole = vi.fn()
vi.mock('@/lib/authz', () => ({ getActor, workspaceRole }))

/** Session-shaped fixture → Actor. `id` is the Better-Auth id (the JWT sub). */
function actorFor(user: { id: string; role: string } | null) {
  if (!user) return null
  return {
    payloadId: `pl-${user.id}`,
    betterAuthId: user.id,
    email: `${user.id}@example.com`,
    role: user.role,
    isPlatformAdmin: user.role === 'super_admin' || user.role === 'admin',
    user: {},
  }
}

// Capture what the interceptor asks the minter to sign.
const mintServiceToken = vi.fn(async () => 'signed-token')
vi.mock('./svc-auth-token', () => ({ mintServiceToken }))

// Avoid pulling the real Payload config/runtime into the node test env. These
// are only reached on the workspace-scoped path, which these tests do not take.
vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

async function runInterceptor(user: unknown, message: unknown = {}) {
  getActor.mockResolvedValue(actorFor(user as { id: string; role: string } | null))
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
    getActor.mockResolvedValue(null)
    const { authInterceptor } = await import('./auth-interceptor')
    const next = vi.fn(async () => 'response')
    const req = { message: {}, header: new Headers() }
    await expect(authInterceptor(next as never)(req as never)).rejects.toThrow(/no authenticated user/)
    expect(mintServiceToken).not.toHaveBeenCalled()
  })

  it('signs the Better-Auth id as sub, never the Payload id', async () => {
    await runInterceptor({ id: 'u1', role: 'user' })
    expect(mintServiceToken).toHaveBeenCalledWith('u1', '', { platformAdmin: false })
  })

  it('workspace-scoped RPC requires real membership even for a platform admin (no bypass)', async () => {
    workspaceRole.mockResolvedValue(null)
    const { authInterceptor } = await import('./auth-interceptor')
    getActor.mockResolvedValue(actorFor({ id: 'u1', role: 'super_admin' }))
    const req = { message: { workspaceId: 'ws-1' }, header: new Headers() }
    await expect(authInterceptor(vi.fn() as never)(req as never)).rejects.toThrow(/not a member/)
    expect(workspaceRole).toHaveBeenCalledWith('ws-1', expect.objectContaining({ betterAuthId: 'u1' }))
    expect(mintServiceToken).not.toHaveBeenCalled()
  })

  it('signs wid for a member of the requested workspace', async () => {
    workspaceRole.mockResolvedValue('member')
    const { next } = await runInterceptor({ id: 'u1', role: 'user' }, { workspaceId: 'ws-1' })
    expect(mintServiceToken).toHaveBeenCalledWith('u1', 'ws-1', { platformAdmin: false })
    expect(next).toHaveBeenCalled()
  })
})
