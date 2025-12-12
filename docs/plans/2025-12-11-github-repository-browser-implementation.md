# GitHub Repository Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to browse and select repositories from their connected GitHub installations when importing apps, with manual URL fallback.

**Architecture:** Server actions fetch installations and repos from GitHub API using existing Octokit integration. New React components provide searchable repository browser. Form conditionally renders browser or manual input based on installation availability.

**Tech Stack:** Next.js Server Actions, Octokit REST API, React Hook Form, Radix UI components, Vitest for testing.

---

## Task 1: Create GitHub Server Actions File

**Files:**
- Create: `orbit-www/src/app/actions/github.ts`
- Test: `orbit-www/src/app/actions/__tests__/github.test.ts`

**Step 1: Write the failing test for getWorkspaceGitHubInstallations**

Create `orbit-www/src/app/actions/__tests__/github.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts`

Expected: FAIL with "Cannot find module '../github'"

**Step 3: Write minimal implementation**

Create `orbit-www/src/app/actions/github.ts`:

```typescript
'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export interface GitHubInstallation {
  id: string
  installationId: number
  accountLogin: string
  accountAvatarUrl: string
  accountType: 'Organization' | 'User'
}

export async function getWorkspaceGitHubInstallations(workspaceId: string): Promise<{
  success: boolean
  error?: string
  installations: GitHubInstallation[]
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized', installations: [] }
  }

  const payload = await getPayload({ config })

  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      and: [
        { allowedWorkspaces: { contains: workspaceId } },
        { status: { equals: 'active' } },
      ],
    },
  })

  return {
    success: true,
    installations: installations.docs.map((doc) => ({
      id: doc.id as string,
      installationId: doc.installationId as number,
      accountLogin: doc.accountLogin as string,
      accountAvatarUrl: (doc.accountAvatarUrl as string) || '',
      accountType: doc.accountType as 'Organization' | 'User',
    })),
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/github.ts orbit-www/src/app/actions/__tests__/github.test.ts
git commit -m "feat(actions): add getWorkspaceGitHubInstallations server action"
```

---

## Task 2: Add listInstallationRepositories Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/github.ts`
- Modify: `orbit-www/src/app/actions/__tests__/github.test.ts`

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/github.test.ts`:

```typescript
// Add to imports at top
vi.mock('@/lib/github/octokit', () => ({
  getInstallationOctokit: vi.fn(),
}))

import { getInstallationOctokit } from '@/lib/github/octokit'
import { listInstallationRepositories } from '../github'

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
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts`

Expected: FAIL with "listInstallationRepositories is not exported"

**Step 3: Write minimal implementation**

Add to `orbit-www/src/app/actions/github.ts`:

```typescript
import { getInstallationOctokit } from '@/lib/github/octokit'

export interface Repository {
  name: string
  fullName: string
  description: string | null
  private: boolean
  defaultBranch: string
}

export async function listInstallationRepositories(
  installationId: string,
  page: number = 1,
  perPage: number = 30
): Promise<{
  success: boolean
  error?: string
  repos: Repository[]
  hasMore: boolean
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized', repos: [], hasMore: false }
  }

  const payload = await getPayload({ config })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id: installationId,
  })

  if (!installation) {
    return { success: false, error: 'Installation not found', repos: [], hasMore: false }
  }

  try {
    const octokit = await getInstallationOctokit(installation.installationId as number)
    const response = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: perPage,
      page,
    })

    const repos: Repository[] = response.data.repositories.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      private: repo.private,
      defaultBranch: repo.default_branch,
    }))

    const totalFetched = page * perPage
    const hasMore = totalFetched < response.data.total_count

    return { success: true, repos, hasMore }
  } catch (error) {
    console.error('Failed to list repositories:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list repositories',
      repos: [],
      hasMore: false,
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/github.ts orbit-www/src/app/actions/__tests__/github.test.ts
git commit -m "feat(actions): add listInstallationRepositories server action"
```

---

## Task 3: Add searchInstallationRepositories Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/github.ts`
- Modify: `orbit-www/src/app/actions/__tests__/github.test.ts`

**Step 1: Write the failing test**

Add to `orbit-www/src/app/actions/__tests__/github.test.ts`:

```typescript
import { searchInstallationRepositories } from '../github'

describe('searchInstallationRepositories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should search repositories by query', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const mockPayload = {
      findByID: vi.fn().mockResolvedValue({
        id: 'install-1',
        installationId: 12345,
        accountLogin: 'acme-org',
      }),
    }
    vi.mocked(getPayload).mockResolvedValue(mockPayload as any)

    const mockOctokit = {
      rest: {
        search: {
          repos: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  name: 'backend-api',
                  full_name: 'acme-org/backend-api',
                  description: 'API service',
                  private: false,
                  default_branch: 'main',
                },
              ],
              total_count: 1,
            },
          }),
        },
      },
    }
    vi.mocked(getInstallationOctokit).mockResolvedValue(mockOctokit as any)

    const result = await searchInstallationRepositories('install-1', 'backend')

    expect(result.success).toBe(true)
    expect(result.repos).toHaveLength(1)
    expect(result.repos[0].name).toBe('backend-api')
    expect(mockOctokit.rest.search.repos).toHaveBeenCalledWith({
      q: 'backend org:acme-org',
      per_page: 30,
    })
  })

  it('should return empty when query is too short', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {},
    } as any)

    const result = await searchInstallationRepositories('install-1', 'ab')

    expect(result.success).toBe(true)
    expect(result.repos).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts`

Expected: FAIL with "searchInstallationRepositories is not exported"

**Step 3: Write minimal implementation**

Add to `orbit-www/src/app/actions/github.ts`:

```typescript
export async function searchInstallationRepositories(
  installationId: string,
  query: string
): Promise<{
  success: boolean
  error?: string
  repos: Repository[]
  hasMore: boolean
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized', repos: [], hasMore: false }
  }

  // Require at least 3 characters for search
  if (query.length < 3) {
    return { success: true, repos: [], hasMore: false }
  }

  const payload = await getPayload({ config })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id: installationId,
  })

  if (!installation) {
    return { success: false, error: 'Installation not found', repos: [], hasMore: false }
  }

  try {
    const octokit = await getInstallationOctokit(installation.installationId as number)
    const accountLogin = installation.accountLogin as string

    const response = await octokit.rest.search.repos({
      q: `${query} org:${accountLogin}`,
      per_page: 30,
    })

    const repos: Repository[] = response.data.items.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? null,
      private: repo.private,
      defaultBranch: repo.default_branch,
    }))

    return { success: true, repos, hasMore: response.data.total_count > 30 }
  } catch (error) {
    console.error('Failed to search repositories:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search repositories',
      repos: [],
      hasMore: false,
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/github.ts orbit-www/src/app/actions/__tests__/github.test.ts
git commit -m "feat(actions): add searchInstallationRepositories server action"
```

---

## Task 4: Update importRepository to Accept installationId

**Files:**
- Modify: `orbit-www/src/app/actions/apps.ts`

**Step 1: Write the failing test**

Create `orbit-www/src/app/actions/__tests__/apps.test.ts` (if not exists) or add:

```typescript
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

import { getPayload } from 'payload'
import { auth } from '@/lib/auth'
import { importRepository } from '../apps'

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
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/apps.test.ts`

Expected: FAIL (installationId not in interface)

**Step 3: Update implementation**

Modify `orbit-www/src/app/actions/apps.ts`:

```typescript
// Update the interface
interface ImportRepositoryInput {
  workspaceId: string
  repositoryUrl: string
  name: string
  description?: string
  installationId?: string  // Add this
}

// Update the function to use installationId
export async function importRepository(input: ImportRepositoryInput) {
  // ... existing auth and membership checks ...

  // Parse repository URL
  const match = input.repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) {
    return { success: false, error: 'Invalid GitHub repository URL' }
  }

  const [, owner, repoName] = match

  try {
    const app = await payload.create({
      collection: 'apps',
      data: {
        name: input.name,
        description: input.description,
        workspace: input.workspaceId,
        repository: {
          owner,
          name: repoName.replace(/\.git$/, ''),
          url: input.repositoryUrl,
          ...(input.installationId && { installationId: input.installationId }),
        },
        origin: {
          type: 'imported',
        },
        status: 'unknown',
        syncMode: 'orbit-primary',
      },
    })

    return { success: true, appId: app.id }
  } catch (error) {
    console.error('Failed to import repository:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to import repository'
    return { success: false, error: errorMessage }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/apps.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/app/actions/apps.ts orbit-www/src/app/actions/__tests__/apps.test.ts
git commit -m "feat(actions): add installationId parameter to importRepository"
```

---

## Task 5: Create RepositoryBrowser Component

**Files:**
- Create: `orbit-www/src/components/features/apps/RepositoryBrowser.tsx`
- Create: `orbit-www/src/components/features/apps/RepositoryBrowser.test.tsx`

**Step 1: Write the failing test**

Create `orbit-www/src/components/features/apps/RepositoryBrowser.test.tsx`:

```typescript
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { RepositoryBrowser } from './RepositoryBrowser'

vi.mock('@/app/actions/github', () => ({
  listInstallationRepositories: vi.fn(),
  searchInstallationRepositories: vi.fn(),
}))

import {
  listInstallationRepositories,
  searchInstallationRepositories,
} from '@/app/actions/github'

describe('RepositoryBrowser', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render search input', async () => {
    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [],
      hasMore: false,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    expect(screen.getByPlaceholderText(/search repositories/i)).toBeInTheDocument()
  })

  it('should display repositories', async () => {
    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'backend', fullName: 'org/backend', description: 'API', private: true, defaultBranch: 'main' },
        { name: 'frontend', fullName: 'org/frontend', description: null, private: false, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('backend')).toBeInTheDocument()
      expect(screen.getByText('frontend')).toBeInTheDocument()
    })
  })

  it('should show private badge for private repos', async () => {
    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'backend', fullName: 'org/backend', description: 'API', private: true, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('private')).toBeInTheDocument()
    })
  })

  it('should call onSelect when repository clicked', async () => {
    const user = userEvent.setup()
    const mockOnSelect = vi.fn()

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'backend', fullName: 'org/backend', description: 'API', private: true, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={mockOnSelect} />)

    await waitFor(() => {
      expect(screen.getByText('backend')).toBeInTheDocument()
    })

    await user.click(screen.getByText('backend'))

    expect(mockOnSelect).toHaveBeenCalledWith({
      name: 'backend',
      fullName: 'org/backend',
      description: 'API',
      private: true,
      defaultBranch: 'main',
    })
  })

  it('should filter repositories client-side', async () => {
    const user = userEvent.setup()

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'backend', fullName: 'org/backend', description: 'API', private: true, defaultBranch: 'main' },
        { name: 'frontend', fullName: 'org/frontend', description: null, private: false, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('backend')).toBeInTheDocument()
    })

    await user.type(screen.getByPlaceholderText(/search repositories/i), 'back')

    expect(screen.getByText('backend')).toBeInTheDocument()
    expect(screen.queryByText('frontend')).not.toBeInTheDocument()
  })

  it('should show Load more button when hasMore is true', async () => {
    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'repo1', fullName: 'org/repo1', description: null, private: false, defaultBranch: 'main' },
      ],
      hasMore: true,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
    })
  })

  it('should show loading skeleton initially', () => {
    vi.mocked(listInstallationRepositories).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    expect(screen.getByTestId('repository-skeleton')).toBeInTheDocument()
  })

  it('should show empty state when no repositories', async () => {
    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [],
      hasMore: false,
    })

    render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/no repositories/i)).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/RepositoryBrowser.test.tsx`

Expected: FAIL with "Cannot find module './RepositoryBrowser'"

**Step 3: Write minimal implementation**

Create `orbit-www/src/components/features/apps/RepositoryBrowser.tsx`:

```typescript
'use client'

import { useState, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Lock, Globe, Loader2 } from 'lucide-react'
import {
  listInstallationRepositories,
  searchInstallationRepositories,
  type Repository,
} from '@/app/actions/github'

interface RepositoryBrowserProps {
  installationId: string
  onSelect: (repo: Repository) => void
}

export function RepositoryBrowser({ installationId, onSelect }: RepositoryBrowserProps) {
  const [repos, setRepos] = useState<Repository[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    async function loadRepos() {
      setIsLoading(true)
      setError(null)
      const result = await listInstallationRepositories(installationId)
      if (result.success) {
        setRepos(result.repos)
        setHasMore(result.hasMore)
      } else {
        setError(result.error || 'Failed to load repositories')
      }
      setIsLoading(false)
    }
    loadRepos()
  }, [installationId])

  // Load more
  const handleLoadMore = async () => {
    setIsLoadingMore(true)
    const nextPage = page + 1
    const result = await listInstallationRepositories(installationId, nextPage)
    if (result.success) {
      setRepos((prev) => [...prev, ...result.repos])
      setHasMore(result.hasMore)
      setPage(nextPage)
    }
    setIsLoadingMore(false)
  }

  // Client-side filter
  const filteredRepos = useMemo(() => {
    if (!searchQuery) return repos
    const query = searchQuery.toLowerCase()
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query)
    )
  }, [repos, searchQuery])

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="repository-skeleton">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[240px] rounded-md border">
        {filteredRepos.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
            No repositories found
          </div>
        ) : (
          <div className="p-1">
            {filteredRepos.map((repo) => (
              <button
                key={repo.fullName}
                onClick={() => onSelect(repo)}
                className="flex w-full items-start gap-3 rounded-md p-3 text-left hover:bg-accent"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{repo.name}</span>
                    <Badge variant={repo.private ? 'secondary' : 'outline'} className="text-xs">
                      {repo.private ? (
                        <>
                          <Lock className="mr-1 h-3 w-3" />
                          private
                        </>
                      ) : (
                        <>
                          <Globe className="mr-1 h-3 w-3" />
                          public
                        </>
                      )}
                    </Badge>
                  </div>
                  {repo.description && (
                    <p className="mt-1 text-sm text-muted-foreground truncate">
                      {repo.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="w-full"
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            'Load more'
          )}
        </Button>
      )}
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/RepositoryBrowser.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/RepositoryBrowser.tsx orbit-www/src/components/features/apps/RepositoryBrowser.test.tsx
git commit -m "feat(ui): add RepositoryBrowser component"
```

---

## Task 6: Create InstallationPicker Component

**Files:**
- Create: `orbit-www/src/components/features/apps/InstallationPicker.tsx`
- Create: `orbit-www/src/components/features/apps/InstallationPicker.test.tsx`

**Step 1: Write the failing test**

Create `orbit-www/src/components/features/apps/InstallationPicker.test.tsx`:

```typescript
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { InstallationPicker } from './InstallationPicker'

describe('InstallationPicker', () => {
  afterEach(() => {
    cleanup()
  })

  const mockInstallations = [
    {
      id: 'install-1',
      installationId: 12345,
      accountLogin: 'acme-org',
      accountAvatarUrl: 'https://github.com/acme.png',
      accountType: 'Organization' as const,
    },
    {
      id: 'install-2',
      installationId: 67890,
      accountLogin: 'other-org',
      accountAvatarUrl: 'https://github.com/other.png',
      accountType: 'Organization' as const,
    },
  ]

  it('should render select with installations', async () => {
    const user = userEvent.setup()

    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={vi.fn()}
      />
    )

    // Open the select
    await user.click(screen.getByRole('combobox'))

    expect(screen.getByText('acme-org')).toBeInTheDocument()
    expect(screen.getByText('other-org')).toBeInTheDocument()
  })

  it('should show selected installation', () => {
    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={mockInstallations[0]}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('acme-org')
  })

  it('should call onSelect when installation selected', async () => {
    const user = userEvent.setup()
    const mockOnSelect = vi.fn()

    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={mockOnSelect}
      />
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('other-org'))

    expect(mockOnSelect).toHaveBeenCalledWith(mockInstallations[1])
  })

  it('should show placeholder when nothing selected', () => {
    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent(/select.*github/i)
  })

  it('should display avatar for installations', async () => {
    const user = userEvent.setup()

    render(
      <InstallationPicker
        installations={mockInstallations}
        selected={null}
        onSelect={vi.fn()}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const avatars = screen.getAllByRole('img')
    expect(avatars.length).toBeGreaterThan(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/InstallationPicker.test.tsx`

Expected: FAIL with "Cannot find module './InstallationPicker'"

**Step 3: Write minimal implementation**

Create `orbit-www/src/components/features/apps/InstallationPicker.tsx`:

```typescript
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GitHubInstallation } from '@/app/actions/github'

interface InstallationPickerProps {
  installations: GitHubInstallation[]
  selected: GitHubInstallation | null
  onSelect: (installation: GitHubInstallation) => void
}

export function InstallationPicker({
  installations,
  selected,
  onSelect,
}: InstallationPickerProps) {
  return (
    <Select
      value={selected?.id || ''}
      onValueChange={(value) => {
        const installation = installations.find((i) => i.id === value)
        if (installation) {
          onSelect(installation)
        }
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a GitHub organization">
          {selected && (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={selected.accountAvatarUrl} alt={selected.accountLogin} />
                <AvatarFallback>{selected.accountLogin[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <span>{selected.accountLogin}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {installations.map((installation) => (
          <SelectItem key={installation.id} value={installation.id}>
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage
                  src={installation.accountAvatarUrl}
                  alt={installation.accountLogin}
                />
                <AvatarFallback>{installation.accountLogin[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <span>{installation.accountLogin}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/InstallationPicker.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/InstallationPicker.tsx orbit-www/src/components/features/apps/InstallationPicker.test.tsx
git commit -m "feat(ui): add InstallationPicker component"
```

---

## Task 7: Integrate Browser into ImportAppForm

**Files:**
- Modify: `orbit-www/src/components/features/apps/ImportAppForm.tsx`
- Modify: `orbit-www/src/components/features/apps/ImportAppForm.test.tsx` (create if not exists)

**Step 1: Write the failing tests**

Create `orbit-www/src/components/features/apps/ImportAppForm.test.tsx`:

```typescript
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ImportAppForm } from './ImportAppForm'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}))

// Mock server actions
vi.mock('@/app/actions/apps', () => ({
  importRepository: vi.fn(),
}))

vi.mock('@/app/actions/github', () => ({
  getWorkspaceGitHubInstallations: vi.fn(),
  listInstallationRepositories: vi.fn(),
  searchInstallationRepositories: vi.fn(),
}))

import { importRepository } from '@/app/actions/apps'
import {
  getWorkspaceGitHubInstallations,
  listInstallationRepositories,
} from '@/app/actions/github'

describe('ImportAppForm', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockWorkspaces = [
    { id: 'ws-1', name: 'Engineering' },
    { id: 'ws-2', name: 'Platform' },
  ]

  it('should show repository browser when installations exist', async () => {
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [
        {
          id: 'install-1',
          installationId: 12345,
          accountLogin: 'acme-org',
          accountAvatarUrl: '',
          accountType: 'Organization',
        },
      ],
    })

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'backend', fullName: 'acme/backend', description: '', private: false, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search repositories/i)).toBeInTheDocument()
    })
  })

  it('should show manual input by default when no installations', async () => {
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [],
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/repository url/i)).toBeInTheDocument()
    })
  })

  it('should toggle to manual input when link clicked', async () => {
    const user = userEvent.setup()

    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [
        {
          id: 'install-1',
          installationId: 12345,
          accountLogin: 'acme-org',
          accountAvatarUrl: '',
          accountType: 'Organization',
        },
      ],
    })

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [],
      hasMore: false,
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByText(/enter a repository url manually/i)).toBeInTheDocument()
    })

    await user.click(screen.getByText(/enter a repository url manually/i))

    expect(screen.getByLabelText(/repository url/i)).toBeInTheDocument()
  })

  it('should auto-fill name when repository selected', async () => {
    const user = userEvent.setup()

    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [
        {
          id: 'install-1',
          installationId: 12345,
          accountLogin: 'acme-org',
          accountAvatarUrl: '',
          accountType: 'Organization',
        },
      ],
    })

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'my-service', fullName: 'acme/my-service', description: '', private: false, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByText('my-service')).toBeInTheDocument()
    })

    await user.click(screen.getByText('my-service'))

    expect(screen.getByLabelText(/application name/i)).toHaveValue('my-service')
  })

  it('should show installation picker when multiple installations', async () => {
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [
        { id: 'install-1', installationId: 12345, accountLogin: 'acme-org', accountAvatarUrl: '', accountType: 'Organization' },
        { id: 'install-2', installationId: 67890, accountLogin: 'other-org', accountAvatarUrl: '', accountType: 'Organization' },
      ],
    })

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [],
      hasMore: false,
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByText(/github installation/i)).toBeInTheDocument()
    })
  })

  it('should submit with installationId when using browser', async () => {
    const user = userEvent.setup()

    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [
        { id: 'install-1', installationId: 12345, accountLogin: 'acme-org', accountAvatarUrl: '', accountType: 'Organization' },
      ],
    })

    vi.mocked(listInstallationRepositories).mockResolvedValue({
      success: true,
      repos: [
        { name: 'backend', fullName: 'acme-org/backend', description: '', private: false, defaultBranch: 'main' },
      ],
      hasMore: false,
    })

    vi.mocked(importRepository).mockResolvedValue({ success: true, appId: 'app-1' })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByText('backend')).toBeInTheDocument()
    })

    await user.click(screen.getByText('backend'))
    await user.click(screen.getByRole('button', { name: /import repository/i }))

    await waitFor(() => {
      expect(importRepository).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        repositoryUrl: 'https://github.com/acme-org/backend',
        name: 'backend',
        description: '',
        installationId: 'install-1',
      })
    })
  })

  it('should refetch installations when workspace changes', async () => {
    const user = userEvent.setup()

    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [],
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(getWorkspaceGitHubInstallations).toHaveBeenCalledWith('ws-1')
    })

    // Change workspace
    await user.click(screen.getByRole('combobox', { name: /workspace/i }))
    await user.click(screen.getByText('Platform'))

    await waitFor(() => {
      expect(getWorkspaceGitHubInstallations).toHaveBeenCalledWith('ws-2')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/ImportAppForm.test.tsx`

Expected: FAIL (new behavior not implemented)

**Step 3: Update implementation**

Replace `orbit-www/src/components/features/apps/ImportAppForm.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ChevronDown, ChevronUp, Github, Info } from 'lucide-react'
import { importRepository } from '@/app/actions/apps'
import {
  getWorkspaceGitHubInstallations,
  type GitHubInstallation,
  type Repository,
} from '@/app/actions/github'
import { RepositoryBrowser } from './RepositoryBrowser'
import { InstallationPicker } from './InstallationPicker'

const formSchema = z.object({
  workspaceId: z.string().min(1, 'Please select a workspace'),
  repositoryUrl: z.string().url('Please enter a valid GitHub URL').optional().or(z.literal('')),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
})

type FormData = z.infer<typeof formSchema>

interface ImportAppFormProps {
  workspaces: { id: string; name: string }[]
}

export function ImportAppForm({ workspaces }: ImportAppFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [installations, setInstallations] = useState<GitHubInstallation[]>([])
  const [selectedInstallation, setSelectedInstallation] = useState<GitHubInstallation | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [isLoadingInstallations, setIsLoadingInstallations] = useState(true)
  const [showManualInput, setShowManualInput] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workspaceId: workspaces[0]?.id || '',
      repositoryUrl: '',
      name: '',
      description: '',
    },
  })

  const workspaceId = form.watch('workspaceId')

  // Fetch installations when workspace changes
  useEffect(() => {
    async function loadInstallations() {
      if (!workspaceId) return

      setIsLoadingInstallations(true)
      setSelectedInstallation(null)
      setSelectedRepo(null)

      const result = await getWorkspaceGitHubInstallations(workspaceId)
      if (result.success) {
        setInstallations(result.installations)
        // Auto-select if only one installation
        if (result.installations.length === 1) {
          setSelectedInstallation(result.installations[0])
        }
        // Show manual input by default if no installations
        if (result.installations.length === 0) {
          setShowManualInput(true)
        } else {
          setShowManualInput(false)
        }
      }
      setIsLoadingInstallations(false)
    }
    loadInstallations()
  }, [workspaceId])

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo)
    form.setValue('name', repo.name)
    form.setValue('repositoryUrl', `https://github.com/${repo.fullName}`)
  }

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      const result = await importRepository({
        workspaceId: data.workspaceId,
        repositoryUrl: data.repositoryUrl || `https://github.com/${selectedRepo?.fullName}`,
        name: data.name,
        description: data.description,
        installationId: selectedInstallation?.id,
      })
      if (result.success && result.appId) {
        router.push(`/apps/${result.appId}`)
      } else {
        form.setError('root', { message: result.error || 'Failed to import repository' })
      }
    } catch (_error) {
      form.setError('root', { message: 'An unexpected error occurred' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Auto-fill name from URL (for manual input)
  const handleUrlChange = (url: string) => {
    form.setValue('repositoryUrl', url)
    const match = url.match(/github\.com\/[^/]+\/([^/]+)/)
    if (match && !form.getValues('name')) {
      form.setValue('name', match[1].replace(/\.git$/, ''))
    }
  }

  const hasInstallations = installations.length > 0
  const hasMultipleInstallations = installations.length > 1

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Workspace Selector */}
            <FormField
              control={form.control}
              name="workspaceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger aria-label="Workspace">
                        <SelectValue placeholder="Select a workspace" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id}>
                          {ws.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Loading state */}
            {isLoadingInstallations && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading GitHub integrations...
              </div>
            )}

            {/* No installations message */}
            {!isLoadingInstallations && !hasInstallations && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No GitHub integrations available.{' '}
                  <a href="/settings/github" className="underline hover:no-underline">
                    Install a GitHub App
                  </a>{' '}
                  in Settings, or enter a URL manually below.
                </AlertDescription>
              </Alert>
            )}

            {/* Installation picker (only if multiple) */}
            {!isLoadingInstallations && hasMultipleInstallations && (
              <FormItem>
                <FormLabel>GitHub Installation</FormLabel>
                <InstallationPicker
                  installations={installations}
                  selected={selectedInstallation}
                  onSelect={setSelectedInstallation}
                />
              </FormItem>
            )}

            {/* Repository Browser */}
            {!isLoadingInstallations && hasInstallations && selectedInstallation && !showManualInput && (
              <FormItem>
                <FormLabel>Repository</FormLabel>
                <RepositoryBrowser
                  installationId={selectedInstallation.id}
                  onSelect={handleRepoSelect}
                />
                {selectedRepo && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Selected: <span className="font-medium">{selectedRepo.fullName}</span>
                  </p>
                )}
              </FormItem>
            )}

            {/* Manual input toggle */}
            {!isLoadingInstallations && hasInstallations && !showManualInput && (
              <button
                type="button"
                onClick={() => setShowManualInput(true)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="h-4 w-4" />
                Or enter a repository URL manually
              </button>
            )}

            {/* Manual URL input */}
            {(!isLoadingInstallations && showManualInput) && (
              <>
                {hasInstallations && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowManualInput(false)
                      setSelectedRepo(null)
                      form.setValue('repositoryUrl', '')
                    }}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ChevronUp className="h-4 w-4" />
                    Back to repository browser
                  </button>
                )}

                <FormField
                  control={form.control}
                  name="repositoryUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repository URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://github.com/org/repo"
                          {...field}
                          onChange={(e) => handleUrlChange(e.target.value)}
                        />
                      </FormControl>
                      <FormDescription>
                        The GitHub repository to import
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Application Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Application Name</FormLabel>
                  <FormControl>
                    <Input placeholder="my-service" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What does this application do?"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || (!selectedRepo && !form.getValues('repositoryUrl'))}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import Repository'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/ImportAppForm.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/ImportAppForm.tsx orbit-www/src/components/features/apps/ImportAppForm.test.tsx
git commit -m "feat(ui): integrate repository browser into ImportAppForm"
```

---

## Task 8: Add Search All Repositories Feature

**Files:**
- Modify: `orbit-www/src/components/features/apps/RepositoryBrowser.tsx`
- Modify: `orbit-www/src/components/features/apps/RepositoryBrowser.test.tsx`

**Step 1: Write the failing test**

Add to `orbit-www/src/components/features/apps/RepositoryBrowser.test.tsx`:

```typescript
it('should show "Search all repositories" button when no local matches', async () => {
  const user = userEvent.setup()

  vi.mocked(listInstallationRepositories).mockResolvedValue({
    success: true,
    repos: [
      { name: 'backend', fullName: 'org/backend', description: 'API', private: true, defaultBranch: 'main' },
    ],
    hasMore: false,
  })

  render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

  await waitFor(() => {
    expect(screen.getByText('backend')).toBeInTheDocument()
  })

  // Type something that doesn't match
  await user.type(screen.getByPlaceholderText(/search repositories/i), 'frontend')

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /search all repositories/i })).toBeInTheDocument()
  })
})

it('should call searchInstallationRepositories when search all clicked', async () => {
  const user = userEvent.setup()

  vi.mocked(listInstallationRepositories).mockResolvedValue({
    success: true,
    repos: [
      { name: 'backend', fullName: 'org/backend', description: 'API', private: true, defaultBranch: 'main' },
    ],
    hasMore: false,
  })

  vi.mocked(searchInstallationRepositories).mockResolvedValue({
    success: true,
    repos: [
      { name: 'frontend', fullName: 'org/frontend', description: 'UI', private: false, defaultBranch: 'main' },
    ],
    hasMore: false,
  })

  render(<RepositoryBrowser installationId="install-1" onSelect={vi.fn()} />)

  await waitFor(() => {
    expect(screen.getByText('backend')).toBeInTheDocument()
  })

  await user.type(screen.getByPlaceholderText(/search repositories/i), 'frontend')
  await user.click(screen.getByRole('button', { name: /search all repositories/i }))

  await waitFor(() => {
    expect(screen.getByText('frontend')).toBeInTheDocument()
  })

  expect(searchInstallationRepositories).toHaveBeenCalledWith('install-1', 'frontend')
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/RepositoryBrowser.test.tsx`

Expected: FAIL

**Step 3: Update implementation**

Update `orbit-www/src/components/features/apps/RepositoryBrowser.tsx` to add the search all functionality:

```typescript
'use client'

import { useState, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Lock, Globe, Loader2 } from 'lucide-react'
import {
  listInstallationRepositories,
  searchInstallationRepositories,
  type Repository,
} from '@/app/actions/github'

interface RepositoryBrowserProps {
  installationId: string
  onSelect: (repo: Repository) => void
}

export function RepositoryBrowser({ installationId, onSelect }: RepositoryBrowserProps) {
  const [repos, setRepos] = useState<Repository[]>([])
  const [searchResults, setSearchResults] = useState<Repository[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    async function loadRepos() {
      setIsLoading(true)
      setError(null)
      setSearchResults(null)
      setSearchQuery('')
      const result = await listInstallationRepositories(installationId)
      if (result.success) {
        setRepos(result.repos)
        setHasMore(result.hasMore)
      } else {
        setError(result.error || 'Failed to load repositories')
      }
      setIsLoading(false)
    }
    loadRepos()
  }, [installationId])

  // Load more
  const handleLoadMore = async () => {
    setIsLoadingMore(true)
    const nextPage = page + 1
    const result = await listInstallationRepositories(installationId, nextPage)
    if (result.success) {
      setRepos((prev) => [...prev, ...result.repos])
      setHasMore(result.hasMore)
      setPage(nextPage)
    }
    setIsLoadingMore(false)
  }

  // Search all repositories
  const handleSearchAll = async () => {
    if (searchQuery.length < 3) return
    setIsSearching(true)
    const result = await searchInstallationRepositories(installationId, searchQuery)
    if (result.success) {
      setSearchResults(result.repos)
    }
    setIsSearching(false)
  }

  // Client-side filter
  const filteredRepos = useMemo(() => {
    // If we have search results from API, use those
    if (searchResults !== null) {
      return searchResults
    }
    // Otherwise filter locally
    if (!searchQuery) return repos
    const query = searchQuery.toLowerCase()
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query)
    )
  }, [repos, searchQuery, searchResults])

  // Reset search results when query changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setSearchResults(null)
  }

  // Show "Search all" button when local filter has no results and query is long enough
  const showSearchAllButton =
    searchResults === null &&
    searchQuery.length >= 3 &&
    filteredRepos.length === 0

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="repository-skeleton">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[240px] rounded-md border">
        {filteredRepos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
            <p className="text-sm text-muted-foreground">No repositories found</p>
            {showSearchAllButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSearchAll}
                disabled={isSearching}
              >
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  'Search all repositories'
                )}
              </Button>
            )}
          </div>
        ) : (
          <div className="p-1">
            {filteredRepos.map((repo) => (
              <button
                key={repo.fullName}
                onClick={() => onSelect(repo)}
                className="flex w-full items-start gap-3 rounded-md p-3 text-left hover:bg-accent"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{repo.name}</span>
                    <Badge variant={repo.private ? 'secondary' : 'outline'} className="text-xs">
                      {repo.private ? (
                        <>
                          <Lock className="mr-1 h-3 w-3" />
                          private
                        </>
                      ) : (
                        <>
                          <Globe className="mr-1 h-3 w-3" />
                          public
                        </>
                      )}
                    </Badge>
                  </div>
                  {repo.description && (
                    <p className="mt-1 text-sm text-muted-foreground truncate">
                      {repo.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {hasMore && !searchQuery && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="w-full"
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            'Load more'
          )}
        </Button>
      )}
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm exec vitest run src/components/features/apps/RepositoryBrowser.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add orbit-www/src/components/features/apps/RepositoryBrowser.tsx orbit-www/src/components/features/apps/RepositoryBrowser.test.tsx
git commit -m "feat(ui): add search all repositories feature to RepositoryBrowser"
```

---

## Task 9: Run Full Test Suite and Fix Issues

**Step 1: Run all related tests**

Run: `cd orbit-www && pnpm exec vitest run src/app/actions/__tests__/github.test.ts src/components/features/apps/RepositoryBrowser.test.tsx src/components/features/apps/InstallationPicker.test.tsx src/components/features/apps/ImportAppForm.test.tsx`

**Step 2: Fix any failing tests**

Address any issues found.

**Step 3: Run TypeScript check**

Run: `cd orbit-www && pnpm exec tsc --noEmit`

**Step 4: Run linting**

Run: `cd orbit-www && pnpm lint`

**Step 5: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: address test and lint issues"
```

---

## Task 10: Manual Testing Checklist

**Step 1: Start development server**

Run: `cd orbit-www && pnpm dev`

**Step 2: Test scenarios**

Navigate to `http://localhost:3000/apps/import` and verify:

1. [ ] With installations: Repository browser appears
2. [ ] Without installations: Manual URL input shown with info message
3. [ ] Multiple installations: Installation picker appears
4. [ ] Single installation: Auto-selected, no picker shown
5. [ ] Repository selection: Auto-fills application name
6. [ ] Manual toggle: Can switch to manual URL input
7. [ ] Search: Client-side filtering works
8. [ ] Search all: API search works when no local matches
9. [ ] Submit: Creates app with installationId
10. [ ] Workspace change: Reloads installations

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete GitHub repository browser for import flow"
```

---

## Summary

This plan implements the GitHub Repository Browser feature in 10 tasks:

1. **Task 1-3**: Server actions for fetching installations and repositories
2. **Task 4**: Update importRepository to accept installationId
3. **Task 5-6**: RepositoryBrowser and InstallationPicker components
4. **Task 7**: Integrate browser into ImportAppForm
5. **Task 8**: Add hybrid search functionality
6. **Task 9-10**: Testing and verification

Each task follows TDD with write-test-first, verify-fail, implement, verify-pass, commit.
