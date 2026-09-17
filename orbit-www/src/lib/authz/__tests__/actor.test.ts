/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSession, ensurePayloadUser, getPayload } = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensurePayloadUser: vi.fn(),
  getPayload: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('@/lib/auth/ensure-payload-user', () => ({ ensurePayloadUser }))
vi.mock('payload', () => ({ getPayload }))
vi.mock('@payload-config', () => ({ default: {} }))

import { getActor, requireActor, UnauthenticatedError, actorFromPayloadUser } from '../actor'

const payloadDoc = {
  id: 'payload-id-1',
  betterAuthId: 'ba-id-1',
  email: 'drew.payment@gmail.com',
  role: 'user',
  status: 'approved',
}

describe('actorFromPayloadUser', () => {
  it('exposes both ids by name and never a bare id', () => {
    const actor = actorFromPayloadUser(payloadDoc as never)
    expect(actor.payloadId).toBe('payload-id-1')
    expect(actor.betterAuthId).toBe('ba-id-1')
    expect(actor.payloadId).not.toBe(actor.betterAuthId)
    expect((actor as Record<string, unknown>).id).toBeUndefined()
  })

  it('derives isPlatformAdmin from role', () => {
    expect(actorFromPayloadUser({ ...payloadDoc, role: 'admin' } as never).isPlatformAdmin).toBe(true)
    expect(actorFromPayloadUser({ ...payloadDoc, role: 'super_admin' } as never).isPlatformAdmin).toBe(true)
    expect(actorFromPayloadUser(payloadDoc as never).isPlatformAdmin).toBe(false)
  })

  it('carries a Payload-shaped user for local API calls', () => {
    const actor = actorFromPayloadUser(payloadDoc as never)
    expect(actor.user).toMatchObject({ id: 'payload-id-1', collection: 'users' })
  })
})

describe('getActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPayload.mockResolvedValue({})
  })

  it('returns null when there is no session', async () => {
    getSession.mockResolvedValue(null)
    expect(await getActor()).toBeNull()
    expect(ensurePayloadUser).not.toHaveBeenCalled()
  })

  it('reads the session with the cookie cache disabled', async () => {
    getSession.mockResolvedValue({ user: { id: 'ba-id-1', email: payloadDoc.email } })
    ensurePayloadUser.mockResolvedValue(payloadDoc)
    await getActor()
    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    )
  })

  it('resolves the Payload doc and returns an Actor', async () => {
    getSession.mockResolvedValue({ user: { id: 'ba-id-1', email: payloadDoc.email } })
    ensurePayloadUser.mockResolvedValue(payloadDoc)
    const actor = await getActor()
    expect(actor).toMatchObject({ payloadId: 'payload-id-1', betterAuthId: 'ba-id-1' })
  })

  it('returns null for a deactivated user even with a live session', async () => {
    getSession.mockResolvedValue({ user: { id: 'ba-id-1', email: payloadDoc.email } })
    ensurePayloadUser.mockResolvedValue({ ...payloadDoc, status: 'deactivated' })
    expect(await getActor()).toBeNull()
  })

  it('returns null when the Payload doc cannot be resolved or self-healed', async () => {
    getSession.mockResolvedValue({ user: { id: 'ba-id-1', email: payloadDoc.email } })
    ensurePayloadUser.mockResolvedValue(null)
    expect(await getActor()).toBeNull()
  })

  it('falls back to the session id when the Payload doc has no betterAuthId', async () => {
    getSession.mockResolvedValue({ user: { id: 'ba-id-1', email: payloadDoc.email } })
    ensurePayloadUser.mockResolvedValue({ ...payloadDoc, betterAuthId: null })
    const actor = await getActor()
    expect(actor?.betterAuthId).toBe('ba-id-1')
  })
})

describe('requireActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPayload.mockResolvedValue({})
  })

  it('throws UnauthenticatedError when unauthenticated', async () => {
    getSession.mockResolvedValue(null)
    await expect(requireActor()).rejects.toBeInstanceOf(UnauthenticatedError)
  })

  it('returns the actor when authenticated', async () => {
    getSession.mockResolvedValue({ user: { id: 'ba-id-1', email: payloadDoc.email } })
    ensurePayloadUser.mockResolvedValue(payloadDoc)
    await expect(requireActor()).resolves.toMatchObject({ payloadId: 'payload-id-1' })
  })
})
