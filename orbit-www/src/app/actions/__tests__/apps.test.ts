import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

/**
 * Mocked at the `@/lib/authz` module boundary (never the real `actor.ts`,
 * which pulls in the Better-Auth Mongo client). `getActor` returns the Actor
 * built from the test's simulated session (`mockSessionUser`, set via
 * `authApi.getSession`'s mocked resolution below); `check` re-derives the
 * caller's workspace role by calling the CURRENTLY mocked `getPayload()`'s
 * `find({ collection: 'workspace-members' })` — the exact query surface these
 * tests already control per-case — so every existing `find` stub (membership
 * present/absent, `role: 'owner'`, …) keeps driving the same ALLOW/DENY
 * outcome it always did.
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
      limit: 1,
    })
    const role = (result.docs[0]?.role as string | undefined) ?? (result.docs.length > 0 ? 'member' : null)
    if (!role) return { allowed: false, reason: 'not a member of this workspace', actor }
    const allowedRoles = resource.roles ?? (verb === 'read' || verb === 'create' ? ['owner', 'admin', 'member'] : ['owner', 'admin'])
    return { allowed: allowedRoles.includes(role), reason: role, actor }
  }),
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
import { getInstallationOctokit } from '@/lib/github/octokit'
import { importRepository, updateAppSettings, deleteApp, exportAppManifest, resolveManifestConflict, disableManifestSync } from '../apps'

describe('importRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should store installationId when provided', async () => {
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue({
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

describe('importRepository — Azure DevOps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const session = { user: { id: 'user-1' }, session: {} }

  function payloadWith(opts: {
    membership?: boolean
    connectionAllowed?: boolean
    create?: ReturnType<typeof vi.fn>
  }) {
    const create = opts.create ?? vi.fn().mockResolvedValue({ id: 'app-1' })
    const find = vi.fn((args: { collection: string }) => {
      if (args.collection === 'workspace-members') {
        return Promise.resolve({ docs: opts.membership === false ? [] : [{ id: 'm1' }] })
      }
      if (args.collection === 'git-connections') {
        return Promise.resolve({
          docs: opts.connectionAllowed === false ? [] : [{ id: 'conn-1', allowedWorkspaces: ['ws-1'] }],
        })
      }
      return Promise.resolve({ docs: [] })
    })
    return { find, create }
  }

  it('creates an ADO row with provider, org, project, connection from a connectionId', async () => {
    authApi.getSession.mockResolvedValue(session as never)
    const create = vi.fn().mockResolvedValue({ id: 'app-ado' })
    const mockPayload = payloadWith({ create })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as never)

    const result = await importRepository({
      workspaceId: 'ws-1',
      repositoryUrl: 'https://dev.azure.com/acme/platform/_git/backend',
      name: 'backend',
      connectionId: 'conn-1',
    })

    expect(result).toEqual({ success: true, appId: 'app-ado' })
    expect(create).toHaveBeenCalledWith({
      collection: 'apps',
      data: expect.objectContaining({
        repository: expect.objectContaining({
          provider: 'azure-devops',
          owner: 'acme',
          project: 'platform',
          name: 'backend',
          url: 'https://dev.azure.com/acme/platform/_git/backend',
          connection: 'conn-1',
        }),
      }),
    })
  })

  it('parses an on-prem _git URL into org/project/repo', async () => {
    authApi.getSession.mockResolvedValue(session as never)
    const create = vi.fn().mockResolvedValue({ id: 'app-ado' })
    vi.mocked(getPayload).mockResolvedValue(payloadWith({ create }) as never)

    await importRepository({
      workspaceId: 'ws-1',
      repositoryUrl: 'https://ado.acme.internal/tfs/DefaultCollection/platform/_git/backend',
      name: 'backend',
      connectionId: 'conn-1',
    })

    expect(create).toHaveBeenCalledWith({
      collection: 'apps',
      data: expect.objectContaining({
        repository: expect.objectContaining({
          owner: 'DefaultCollection',
          project: 'platform',
          name: 'backend',
        }),
      }),
    })
  })

  it('rejects when the connection is not allowed for the workspace', async () => {
    authApi.getSession.mockResolvedValue(session as never)
    const create = vi.fn()
    vi.mocked(getPayload).mockResolvedValue(
      payloadWith({ connectionAllowed: false, create }) as never,
    )

    const result = await importRepository({
      workspaceId: 'ws-1',
      repositoryUrl: 'https://dev.azure.com/acme/platform/_git/backend',
      name: 'backend',
      connectionId: 'conn-1',
    })

    expect(result.success).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an unparseable URL naming both accepted shapes', async () => {
    authApi.getSession.mockResolvedValue(session as never)
    const create = vi.fn()
    vi.mocked(getPayload).mockResolvedValue(payloadWith({ create }) as never)

    const result = await importRepository({
      workspaceId: 'ws-1',
      repositoryUrl: 'https://example.com/not/a/repo',
      name: 'x',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/github/i)
    expect(result.error).toMatch(/azure devops|dev\.azure\.com/i)
    expect(create).not.toHaveBeenCalled()
  })

  it('leaves GitHub imports on the unchanged github path (no provider field)', async () => {
    authApi.getSession.mockResolvedValue(session as never)
    const create = vi.fn().mockResolvedValue({ id: 'app-gh' })
    vi.mocked(getPayload).mockResolvedValue(payloadWith({ create }) as never)

    await importRepository({
      workspaceId: 'ws-1',
      repositoryUrl: 'https://github.com/acme/backend',
      name: 'backend',
      installationId: 'install-1',
    })

    const call = create.mock.calls[0][0]
    expect(call.data.repository.owner).toBe('acme')
    expect(call.data.repository.provider).toBeUndefined()
    expect(call.data.repository.installationId).toBe('install-1')
  })
})

describe('updateAppSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return unauthorized when no session', async () => {
    authApi.getSession.mockResolvedValue(null)

    const result = await updateAppSettings('app-1', { name: 'new-name' })

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when app not found', async () => {
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue(null)

    const result = await deleteApp('app-1', 'my-app')

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when app not found', async () => {
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue({
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
    authApi.getSession.mockResolvedValue(null)

    await expect(exportAppManifest('app-1')).rejects.toThrow('Not authenticated')
  })

  it('should throw when app has no repository URL or installationId', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        name: 'my-app',
        workspace: 'ws-1',
        repository: {},
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ role: 'owner' }] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await expect(exportAppManifest('app-1')).rejects.toThrow(
      'App must have a linked repository with a GitHub installation to export a manifest',
    )
  })

  it('throws when the actor is not a member of the app workspace', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        name: 'my-app',
        workspace: 'ws-1',
        repository: { url: 'https://github.com/acme/repo', installationId: '123' },
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await expect(exportAppManifest('app-1')).rejects.toThrow(
      'You do not have permission to view this app.',
    )
  })
})

describe('resolveManifestConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws if user is not authenticated', async () => {
    authApi.getSession.mockResolvedValueOnce(null)
    await expect(resolveManifestConflict('app-id', 'keep-orbit')).rejects.toThrow('Not authenticated')
  })

  it('throws when the actor is not a member of the app workspace', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'app-id',
        workspace: 'ws-1',
        conflictDetected: true,
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await expect(resolveManifestConflict('app-id', 'keep-orbit')).rejects.toThrow(
      'You do not have permission to update this app.',
    )
  })
})

describe('disableManifestSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws if user is not authenticated', async () => {
    authApi.getSession.mockResolvedValueOnce(null)
    await expect(disableManifestSync('app-id')).rejects.toThrow('Not authenticated')
  })

  it('throws when the actor is not a member of the app workspace', async () => {
    authApi.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'app-id',
        workspace: 'ws-1',
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    await expect(disableManifestSync('app-id')).rejects.toThrow(
      'You do not have permission to update this app.',
    )
  })
})
