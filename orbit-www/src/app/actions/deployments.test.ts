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
  createInstallationToken: vi.fn(),
}))

vi.mock('@/lib/clients/deployment-client', () => ({
  startDeploymentWorkflow: vi.fn(),
  getDeploymentProgress: vi.fn(),
}))

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { createInstallationToken } from '@/lib/github/octokit'
import { getRepoBranches, commitGeneratedFiles } from './deployments'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function mockSession(userId = 'user-1') {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId },
    session: {},
  } as any)
}

function buildMockPayload(overrides: Record<string, unknown> = {}) {
  return {
    findByID: vi.fn(),
    find: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getRepoBranches
// ---------------------------------------------------------------------------

describe('getRepoBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns Unauthorized when there is no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await getRepoBranches('app-1')

    expect(result).toEqual({ success: false, error: 'Unauthorized', branches: [] })
  })

  it('falls back to main when app has no repository config', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      // App without repository config; workspace is a string so membership check runs
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        workspace: 'workspace-1',
        // repository intentionally omitted / empty
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getRepoBranches('app-1')

    expect(result).toEqual({ success: true, branches: ['main'], defaultBranch: 'main' })
  })

  it('returns Not a member of this workspace when user is not an active member', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        workspace: 'workspace-1',
      }),
      find: vi.fn().mockResolvedValue({ docs: [] }), // no membership
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await getRepoBranches('app-1')

    expect(result).toEqual({
      success: false,
      error: 'Not a member of this workspace',
      branches: [],
    })
  })

  it('returns branches and defaultBranch on success', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        workspace: 'workspace-1',
        repository: {
          installationId: '99',
          owner: 'acme',
          name: 'backend',
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(createInstallationToken).mockResolvedValue({
      token: 'gh-token',
      expiresAt: new Date(),
    })

    // Branches list response
    const branchesResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue([{ name: 'main' }, { name: 'develop' }, { name: 'feature/x' }]),
    }
    // Repo meta response
    const repoResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ default_branch: 'main' }),
    }

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(branchesResponse)
        .mockResolvedValueOnce(repoResponse),
    )

    const result = await getRepoBranches('app-1')

    expect(result).toEqual({
      success: true,
      branches: ['main', 'develop', 'feature/x'],
      defaultBranch: 'main',
    })
  })

  it('falls back to ["main"] when the GitHub branches API returns a non-ok response', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'app-1',
        workspace: 'workspace-1',
        repository: {
          installationId: '99',
          owner: 'acme',
          name: 'backend',
        },
      }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(createInstallationToken).mockResolvedValue({
      token: 'gh-token',
      expiresAt: new Date(),
    })

    const failResponse = { ok: false, status: 404 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failResponse))

    const result = await getRepoBranches('app-1')

    expect(result).toEqual({ success: true, branches: ['main'], defaultBranch: 'main' })
  })
})

// ---------------------------------------------------------------------------
// commitGeneratedFiles
// ---------------------------------------------------------------------------

describe('commitGeneratedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validInput = {
    deploymentId: 'deploy-1',
    branch: 'main',
    message: 'chore: add generated files',
  }

  it('returns Unauthorized when there is no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns Deployment not found when deployment is missing', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi.fn().mockResolvedValue(null),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: false, error: 'Deployment not found' })
  })

  it('returns No generated files to commit when generatedFiles is empty', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'deploy-1',
        app: 'app-1',
        generatedFiles: [],
      }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: false, error: 'No generated files to commit' })
  })

  it('returns Commit message is required when message is blank', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi.fn().mockResolvedValue({
        id: 'deploy-1',
        app: 'app-1',
        generatedFiles: [{ path: 'docker-compose.yml', content: 'version: "3"' }],
      }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await commitGeneratedFiles({ ...validInput, message: '   ' })

    expect(result).toEqual({ success: false, error: 'Commit message is required' })
  })

  it('returns Not a member of this workspace when user is not an active member', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      // First call: deployment lookup; second call: app lookup
      findByID: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'deploy-1',
          app: 'app-1',
          generatedFiles: [{ path: 'docker-compose.yml', content: 'version: "3"' }],
        })
        .mockResolvedValueOnce({
          id: 'app-1',
          workspace: 'workspace-1',
        }),
      find: vi.fn().mockResolvedValue({ docs: [] }), // no membership
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: false, error: 'Not a member of this workspace' })
  })

  it('returns App has no linked repository when repository is not configured', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'deploy-1',
          app: 'app-1',
          generatedFiles: [{ path: 'docker-compose.yml', content: 'version: "3"' }],
        })
        .mockResolvedValueOnce({
          id: 'app-1',
          workspace: 'workspace-1',
          // repository intentionally missing
        }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: false, error: 'App has no linked repository' })
  })

  it('returns an error when the GitHub ref lookup fails (step 1 — ref not found)', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'deploy-1',
          app: 'app-1',
          generatedFiles: [{ path: 'docker-compose.yml', content: 'version: "3"' }],
        })
        .mockResolvedValueOnce({
          id: 'app-1',
          workspace: 'workspace-1',
          repository: { installationId: '99', owner: 'acme', name: 'backend' },
        }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(createInstallationToken).mockResolvedValue({
      token: 'gh-token',
      expiresAt: new Date(),
    })

    // First fetch call is the ref lookup — simulate 404
    const failResponse = { ok: false, status: 404 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failResponse))

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: false, error: `Branch "${validInput.branch}" not found` })
  })

  it('returns { success: true, sha } on full success with newBranch path', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'deploy-1',
          app: 'app-1',
          generatedFiles: [{ path: 'docker-compose.yml', content: 'version: "3"' }],
        })
        .mockResolvedValueOnce({
          id: 'app-1',
          workspace: 'workspace-1',
          repository: { installationId: '99', owner: 'acme', name: 'backend' },
        }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      update: vi.fn().mockResolvedValue({}),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(createInstallationToken).mockResolvedValue({
      token: 'gh-token',
      expiresAt: new Date(),
    })

    const commitSha = 'abc123def456'

    // Steps (in order):
    // 1. GET ref/heads/main           -> ok, baseSha
    // 2. POST git/refs (newBranch)    -> ok
    // 3. GET git/commits/:sha         -> ok, baseTreeSha
    // 4. POST git/blobs               -> ok, blobSha
    // 5. POST git/trees               -> ok, treeSha
    // 6. POST git/commits             -> ok, commitSha
    // 7. PATCH git/refs/heads/:branch -> ok

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ object: { sha: 'base-sha' } }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ tree: { sha: 'tree-sha' } }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ sha: 'blob-sha' }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ sha: 'new-tree-sha' }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ sha: commitSha }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) }),
    )

    const result = await commitGeneratedFiles({
      ...validInput,
      newBranch: 'feature/generated',
    })

    expect(result).toEqual({ success: true, sha: commitSha })
  })

  it('returns { success: true, sha } on full success with branch-only path (no newBranch)', async () => {
    mockSession()

    const mockPayload = buildMockPayload({
      findByID: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'deploy-1',
          app: 'app-1',
          generatedFiles: [{ path: 'docker-compose.yml', content: 'version: "3"' }],
        })
        .mockResolvedValueOnce({
          id: 'app-1',
          workspace: 'workspace-1',
          repository: { installationId: '99', owner: 'acme', name: 'backend' },
        }),
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'membership-1' }] }),
      update: vi.fn().mockResolvedValue({}),
    })
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)
    vi.mocked(createInstallationToken).mockResolvedValue({
      token: 'gh-token',
      expiresAt: new Date(),
    })

    const commitSha = 'deadbeef1234'

    // Steps (in order, no newBranch so step 2 is skipped):
    // 1. GET ref/heads/main           -> ok, baseSha
    // 2. GET git/commits/:sha         -> ok, baseTreeSha
    // 3. POST git/blobs               -> ok, blobSha
    // 4. POST git/trees               -> ok, treeSha
    // 5. POST git/commits             -> ok, commitSha
    // 6. PATCH git/refs/heads/:branch -> ok

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ object: { sha: 'base-sha' } }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ tree: { sha: 'tree-sha' } }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ sha: 'blob-sha' }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ sha: 'new-tree-sha' }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ sha: commitSha }) })
        .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) }),
    )

    const result = await commitGeneratedFiles(validInput)

    expect(result).toEqual({ success: true, sha: commitSha })
  })
})
