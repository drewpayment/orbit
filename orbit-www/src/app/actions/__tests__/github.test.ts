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

vi.mock('@/lib/github/octokit', () => ({
  getInstallationOctokit: vi.fn(),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { getInstallationOctokit } from '@/lib/github/octokit'
import { getWorkspaceGitHubInstallations, listInstallationRepositories } from '../github'

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

describe('listInstallationRepositories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized error when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await listInstallationRepositories('install-1')

    expect(result).toEqual({
      success: false,
      error: 'Unauthorized',
      repos: [],
      hasMore: false,
    })
  })

  it('should return repositories from GitHub API', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'install-1',
        installationId: 12345,
        allowedWorkspaces: ['workspace-1'],
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const mockOctokit = {
      rest: {
        apps: {
          listReposAccessibleToInstallation: vi.fn().mockResolvedValue({
            data: {
              repositories: [
                {
                  name: 'backend',
                  full_name: 'acme-org/backend',
                  description: 'Backend service',
                  private: true,
                  default_branch: 'main',
                },
                {
                  name: 'frontend',
                  full_name: 'acme-org/frontend',
                  description: null,
                  private: false,
                  default_branch: 'master',
                },
              ],
              total_count: 2,
            },
          }),
        },
      },
    }
    vi.mocked(getInstallationOctokit).mockResolvedValue(mockOctokit as any)

    const result = await listInstallationRepositories('install-1')

    expect(result.success).toBe(true)
    expect(result.repos).toHaveLength(2)
    expect(result.repos[0]).toEqual({
      name: 'backend',
      fullName: 'acme-org/backend',
      description: 'Backend service',
      private: true,
      defaultBranch: 'main',
    })
    expect(result.repos[1].description).toBeNull()
    expect(result.hasMore).toBe(false)
  })

  it('should handle pagination', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'install-1',
        installationId: 12345,
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const mockOctokit = {
      rest: {
        apps: {
          listReposAccessibleToInstallation: vi.fn().mockResolvedValue({
            data: {
              repositories: Array(30).fill({
                name: 'repo',
                full_name: 'org/repo',
                description: null,
                private: false,
                default_branch: 'main',
              }),
              total_count: 50,
            },
          }),
        },
      },
    }
    vi.mocked(getInstallationOctokit).mockResolvedValue(mockOctokit as any)

    const result = await listInstallationRepositories('install-1', 1, 30)

    expect(result.hasMore).toBe(true)
    expect(mockOctokit.rest.apps.listReposAccessibleToInstallation).toHaveBeenCalledWith({
      per_page: 30,
      page: 1,
    })
  })

  it('should return error when installation not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await listInstallationRepositories('nonexistent')

    expect(result).toEqual({
      success: false,
      error: 'Installation not found',
      repos: [],
      hasMore: false,
    })
  })
})
