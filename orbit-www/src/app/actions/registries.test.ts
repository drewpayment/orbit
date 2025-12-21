import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module
vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted:${val}`),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
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
    ;(auth.api.getSession as any).mockResolvedValue(null)

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns error if registry not found', async () => {
    ;(auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue(null)

    const result = await testGhcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Registry not found' })
  })

  it('returns error if not a GHCR registry', async () => {
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue(null)

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns error if registry not found', async () => {
    ;(auth.api.getSession as any).mockResolvedValue({
      user: { id: 'user-123' },
    })
    mockPayload.findByID.mockResolvedValue(null)

    const result = await testAcrConnection('config-123')

    expect(result).toEqual({ success: false, error: 'Registry not found' })
  })

  it('returns error if not an ACR registry', async () => {
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
    ;(auth.api.getSession as any).mockResolvedValue({
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
