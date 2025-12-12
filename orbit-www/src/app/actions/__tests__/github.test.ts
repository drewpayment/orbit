import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
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

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { getWorkspaceGitHubInstallations } from '../github'

describe('getWorkspaceGitHubInstallations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized error when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getWorkspaceGitHubInstallations('workspace-1')

    expect(result).toEqual({
      success: false,
      error: 'Unauthorized',
      installations: [],
    })
  })

  it('should return installations for workspace', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({
        docs: [
          {
            id: 'install-1',
            installationId: 12345,
            accountLogin: 'acme-org',
            accountAvatarUrl: 'https://github.com/acme.png',
            accountType: 'Organization',
          },
        ],
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getWorkspaceGitHubInstallations('workspace-1')

    expect(result.success).toBe(true)
    expect(result.installations).toHaveLength(1)
    expect(result.installations[0]).toEqual({
      id: 'install-1',
      installationId: 12345,
      accountLogin: 'acme-org',
      accountAvatarUrl: 'https://github.com/acme.png',
      accountType: 'Organization',
    })
  })

  it('should filter by allowedWorkspaces', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await getWorkspaceGitHubInstallations('workspace-1')

    expect(mockPayload.find).toHaveBeenCalledWith({
      collection: 'github-installations',
      where: {
        and: [
          { allowedWorkspaces: { contains: 'workspace-1' } },
          { status: { equals: 'active' } },
        ],
      },
    })
  })
})
