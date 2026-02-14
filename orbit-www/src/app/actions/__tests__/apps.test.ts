import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/app-manifest', () => ({
  serializeAppManifest: vi.fn(() => 'apiVersion: orbit.dev/v1\nkind: Application\n'),
}))

vi.mock('@/lib/github-manifest', () => ({
  parseGitHubUrl: vi.fn((url: string) => {
    const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }),
  generateWebhookSecret: vi.fn(() => 'mock-webhook-secret'),
}))

vi.mock('@/lib/github/octokit', () => ({
  getInstallationOctokit: vi.fn(),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { getInstallationOctokit } from '@/lib/github/octokit'
import { importRepository, updateAppSettings, deleteApp, exportAppManifest, resolveManifestConflict, disableManifestSync } from '../apps'

describe('importRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should store installationId when provided', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await importRepository({
      workspaceId: 'workspace-1',
      repositoryUrl: 'https://github.com/acme/repo',
      name: 'my-app',
      installationId: 'install-1',
    })

    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'apps',
      data: expect.objectContaining({
        repository: expect.objectContaining({
          installationId: 'install-1',
        }),
      }),
    })
  })

  it('should work without installationId', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await importRepository({
      workspaceId: 'workspace-1',
      repositoryUrl: 'https://github.com/acme/repo',
      name: 'my-app',
    })

    expect(mockPayload.create).toHaveBeenCalledWith({
      collection: 'apps',
      data: expect.objectContaining({
        repository: expect.not.objectContaining({
          installationId: expect.anything(),
        }),
      }),
    })
  })
})

describe('updateAppSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await updateAppSettings('app-1', { name: 'new-name' })

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when app not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await updateAppSettings('app-1', { name: 'new-name' })

    expect(result).toEqual({ success: false, error: 'App not found' })
  })

  it('should return error when user is not a workspace member', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({ id: 'app-1', workspace: 'workspace-1' }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await updateAppSettings('app-1', { name: 'new-name' })

    expect(result).toEqual({ success: false, error: 'Not authorized to update this app' })
  })

  it('should update app settings successfully', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        workspace: 'workspace-1',
        repository: { owner: 'acme', name: 'repo', branch: 'main' },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      update: vi.fn().mockResolvedValue({ id: 'app-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await updateAppSettings('app-1', {
      name: 'new-name',
      description: 'new description',
      healthConfig: {
        url: 'https://api.example.com/health',
        method: 'GET',
        interval: 60,
        timeout: 10,
        expectedStatus: 200,
      },
      branch: 'develop',
    })

    expect(result).toEqual({ success: true })
    expect(mockPayload.update).toHaveBeenCalledWith({
      collection: 'apps',
      id: 'app-1',
      data: expect.objectContaining({
        name: 'new-name',
        description: 'new description',
        healthConfig: expect.objectContaining({
          url: 'https://api.example.com/health',
        }),
        repository: expect.objectContaining({
          branch: 'develop',
        }),
      }),
    })
  })
})

describe('deleteApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await deleteApp('app-1', 'my-app')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when app not found', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue(null),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await deleteApp('app-1', 'my-app')

    expect(result).toEqual({ success: false, error: 'App not found' })
  })

  it('should return error when confirmation name does not match', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({ id: 'app-1', name: 'my-app', workspace: 'workspace-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await deleteApp('app-1', 'wrong-name')

    expect(result).toEqual({ success: false, error: 'App name does not match' })
  })

  it('should return error when user is not an owner or admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({ id: 'app-1', name: 'my-app', workspace: 'workspace-1' }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await deleteApp('app-1', 'my-app')

    expect(result).toEqual({ success: false, error: 'Only workspace owners and admins can delete apps' })
  })

  it('should delete app successfully when user is owner', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({ id: 'app-1', name: 'my-app', workspace: 'workspace-1' }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1', role: 'owner' }] }),
      delete: vi.fn().mockResolvedValue({ id: 'app-1' }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await deleteApp('app-1', 'my-app')

    expect(result).toEqual({ success: true })
    expect(mockPayload.delete).toHaveBeenCalledWith({
      collection: 'apps',
      id: 'app-1',
    })
  })
})

describe('exportAppManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw Not authenticated when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    await expect(exportAppManifest('app-1')).rejects.toThrow('Not authenticated')
  })

  it('should throw when app has no repository URL or installationId', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        name: 'my-app',
        repository: {},
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await expect(exportAppManifest('app-1')).rejects.toThrow(
      'App must have a linked repository with a GitHub installation to export a manifest',
    )
  })
})

describe('resolveManifestConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws if user is not authenticated', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    await expect(resolveManifestConflict('app-id', 'keep-orbit')).rejects.toThrow('Not authenticated')
  })
})

describe('disableManifestSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws if user is not authenticated', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null)
    await expect(disableManifestSync('app-id')).rejects.toThrow('Not authenticated')
  })
})
