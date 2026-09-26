import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

/**
 * Mocked at the `@/lib/authz` module boundary (never the real `actor.ts`,
 * which pulls in the Better-Auth Mongo client). `getActor` returns the Actor
 * built from the test's simulated session (`authApi.getSession`, kept as a
 * drop-in for the old `auth.api.getSession` mock); `check` re-derives the
 * caller's workspace role by calling the CURRENTLY mocked `getPayload()`'s
 * `find({ collection: 'workspace-members' })` — the exact `docs: [...]` /
 * `docs: []` stubs these tests already set per-case — so every existing
 * membership fixture (`role: 'admin'`, no docs, …) keeps driving the same
 * ALLOW/DENY outcome it always did.
 */
const authApi = { getSession: vi.fn() }
vi.mock('@/lib/authz', () => ({
  getActor: vi.fn(async () => {
    const session = await authApi.getSession()
    if (!session?.user) return null
    return {
      payloadId: session.user.id,
      betterAuthId: session.user.id,
      email: session.user.email ?? '',
      role: 'user',
      isPlatformAdmin: false,
      user: session.user,
    }
  }),
  check: vi.fn(async (verb: string, resource: { kind: string; id?: string; roles?: string[] }, actorArg?: unknown) => {
    const session = await authApi.getSession()
    const actor = (actorArg as { betterAuthId: string } | undefined) ?? (session?.user ? { betterAuthId: session.user.id } : null)
    if (!actor) return { allowed: false, reason: 'unauthenticated', actor: null }
    if (resource.kind !== 'workspace') return { allowed: false, reason: 'platform admin required', actor }
    const { getPayload } = await import('payload')
    const payload = await getPayload({} as never)
    const result = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: resource.id } },
          { user: { equals: actor.betterAuthId } },
          { status: { equals: 'active' } },
        ],
      },
    })
    const role = (result.docs[0]?.role as string | undefined) ?? (result.docs.length > 0 ? 'member' : null)
    if (!role) return { allowed: false, reason: 'not a member of this workspace', actor }
    const allowedRoles = resource.roles ?? (verb === 'read' || verb === 'create' ? ['owner', 'admin', 'member'] : ['owner', 'admin'])
    return { allowed: allowedRoles.includes(role), reason: role, actor }
  }),
  memberWorkspaceIds: vi.fn(async () => []),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted:${val}`),
}))

import { getPayload } from 'payload'
import { testGhcrConnection, testAcrConnection } from './registries'

describe('testGhcrConnection', () => {
  const mockPayload = {
    findByID: vi.fn(),
    find: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
  })

  it('returns unauthorized if no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns error if registry not found', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue(null)

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Registry not found' })
  })

  it('returns error if not a GHCR registry', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
    })

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Not a GHCR registry' })
  })

  it('returns error if no PAT configured', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'ghcr',
      workspace: 'workspace-123',
      ghcrOwner: 'test-owner',
      // No ghcrPat
    })

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'No PAT configured' })
  })

  it('returns error if user not authorized for workspace', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'ghcr',
      workspace: 'workspace-123',
      ghcrOwner: 'test-owner',
      ghcrPat: 'encrypted-pat',
    })
    mockPayload.find.mockResolvedValue({ docs: [] }) // No membership

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({
      success: false,
      error: 'Not authorized for this workspace',
    })
  })

  it('successfully validates PAT against GitHub API', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'ghcr',
      workspace: 'workspace-123',
      ghcrOwner: 'test-owner',
      ghcrPat: 'encrypted-pat',
    })
    mockPayload.find.mockResolvedValue({
      docs: [{ role: 'admin', status: 'active' }],
    })
    mockPayload.update.mockResolvedValue({})

    // Mock successful GitHub API call
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    })
    global.fetch = mockFetch

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'registry-configs',
        id: 'config-123',
        data: expect.objectContaining({
          ghcrValidationStatus: 'valid',
        }),
      })
    )
  })

  it('returns error when GitHub API returns failure', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'ghcr',
      workspace: 'workspace-123',
      ghcrOwner: 'test-owner',
      ghcrPat: 'encrypted-pat',
    })
    mockPayload.find.mockResolvedValue({
      docs: [{ role: 'admin', status: 'active' }],
    })
    mockPayload.update.mockResolvedValue({})

    // Mock failed GitHub API call
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Bad credentials'),
    })
    global.fetch = mockFetch

    const result = await testGhcrConnection('config-123')

    expect(result.success).toBe(false)
    expect(result.error).toContain('GitHub API returned 401')
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ghcrValidationStatus: 'invalid',
        }),
      })
    )
  })
})

describe('testAcrConnection', () => {
  const mockPayload = {
    findByID: vi.fn(),
    find: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(getPayload as any).mockResolvedValue(mockPayload)
  })

  it('returns unauthorized if no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns error if registry not found', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue(null)

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Registry not found' })
  })

  it('returns error if not an ACR registry', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'ghcr',
      workspace: 'workspace-123',
    })

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Not an ACR registry' })
  })

  it('returns error if no token configured', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
      acrLoginServer: 'myregistry.azurecr.io',
      acrUsername: 'orbit-token',
      // No acrToken
    })

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'No token configured' })
  })

  it('returns error if no username configured', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
      acrLoginServer: 'myregistry.azurecr.io',
      acrToken: 'encrypted-token',
      // No acrUsername
    })

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'No username configured' })
  })

  it('returns error if no login server configured', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
      acrUsername: 'orbit-token',
      acrToken: 'encrypted-token',
      // No acrLoginServer
    })

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'No login server configured' })
  })

  it('returns error if user not authorized for workspace', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
      acrLoginServer: 'myregistry.azurecr.io',
      acrUsername: 'orbit-token',
      acrToken: 'encrypted-token',
    })
    mockPayload.find.mockResolvedValue({ docs: [] }) // No membership

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({
      success: false,
      error: 'Not authorized for this workspace',
    })
  })

  it('successfully validates token against ACR API', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
      acrLoginServer: 'myregistry.azurecr.io',
      acrUsername: 'orbit-token',
      acrToken: 'encrypted-token',
    })
    mockPayload.find.mockResolvedValue({
      docs: [{ role: 'admin', status: 'active' }],
    })
    mockPayload.update.mockResolvedValue({})

    // Mock successful ACR API call
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    })
    global.fetch = mockFetch

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'registry-configs',
        id: 'config-123',
        data: expect.objectContaining({
          acrValidationStatus: 'valid',
        }),
      })
    )
  })

  it('returns error when ACR API returns failure', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue({
      id: 'config-123',
      type: 'acr',
      workspace: 'workspace-123',
      acrLoginServer: 'myregistry.azurecr.io',
      acrUsername: 'orbit-token',
      acrToken: 'encrypted-token',
    })
    mockPayload.find.mockResolvedValue({
      docs: [{ role: 'admin', status: 'active' }],
    })
    mockPayload.update.mockResolvedValue({})

    // Mock failed ACR API call
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    global.fetch = mockFetch

    const result = await testAcrConnection('config-123')

    expect(result.success).toBe(false)
    expect(result.error).toContain('ACR API returned 401')
    expect(mockPayload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acrValidationStatus: 'invalid',
        }),
      })
    )
  })
})
