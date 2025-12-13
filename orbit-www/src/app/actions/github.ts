'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getInstallationOctokit } from '@/lib/github/octokit'

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
    const response = await octokit.request('GET /installation/repositories', {
      per_page: perPage,
      page,
    })

    const repos: Repository[] = response.data.repositories.map((repo: any) => ({
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

    const response = await octokit.request('GET /search/repositories', {
      q: `${query} org:${accountLogin}`,
      per_page: 30,
    })

    const repos: Repository[] = response.data.items.map((repo: any) => ({
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

export async function getRepositoryBranches(
  installationId: string,
  owner: string,
  repo: string
): Promise<{ success: boolean; branches?: string[]; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id: installationId,
  })

  if (!installation) {
    return { success: false, error: 'Installation not found' }
  }

  try {
    const octokit = await getInstallationOctokit(installation.installationId as number)

    // Fetch branches - GitHub returns up to 100 per page by default
    const response = await octokit.request('GET /repos/{owner}/{repo}/branches', {
      owner,
      repo,
      per_page: 100,
    })

    // Extract branch names and sort alphabetically
    const branches = response.data
      .map((branch: { name: string }) => branch.name)
      .sort((a: string, b: string) => {
        // Put 'main' and 'master' first
        if (a === 'main' || a === 'master') return -1
        if (b === 'main' || b === 'master') return 1
        return a.localeCompare(b)
      })

    return { success: true, branches }
  } catch (error) {
    console.error('Failed to fetch repository branches:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch branches',
    }
  }
}
