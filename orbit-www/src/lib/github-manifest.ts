// orbit-www/src/lib/github-manifest.ts
import { Octokit } from '@octokit/rest'
import { randomBytes } from 'crypto'

export interface GitHubRepoInfo {
  owner: string
  repo: string
  defaultBranch: string
  isTemplate: boolean
  description: string | null
}

/**
 * Parse GitHub URL to extract owner and repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle various GitHub URL formats
  const patterns = [
    /github\.com\/([^\/]+)\/([^\/\.]+)/,
    /github\.com:([^\/]+)\/([^\/\.]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return { owner: match[1], repo: match[2].replace('.git', '') }
    }
  }

  return null
}

/**
 * Fetch repository info from GitHub
 */
export async function fetchRepoInfo(
  url: string,
  accessToken: string
): Promise<GitHubRepoInfo | null> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return null

  const octokit = new Octokit({ auth: accessToken })

  try {
    const { data } = await octokit.repos.get({
      owner: parsed.owner,
      repo: parsed.repo,
    })

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      defaultBranch: data.default_branch,
      isTemplate: data.is_template ?? false,
      description: data.description,
    }
  } catch (error: unknown) {
    // Log detailed error for debugging
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status
      const message = 'message' in error ? (error as { message: string }).message : 'Unknown error'
      console.error(`GitHub API error (${status}): ${message}`)
    } else {
      console.error('Error fetching repo info:', error)
    }
    return null
  }
}

/**
 * Fetch manifest file content from GitHub
 */
export async function fetchManifestContent(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  accessToken: string
): Promise<string | null> {
  const octokit = new Octokit({ auth: accessToken })

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    })

    if ('content' in data && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8')
    }

    return null
  } catch (error) {
    console.error('Error fetching manifest:', error)
    return null
  }
}

/**
 * Check if a file exists in the repository
 */
export async function fileExists(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  accessToken: string
): Promise<boolean> {
  const octokit = new Octokit({ auth: accessToken })

  try {
    await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Generate a secure random webhook secret
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}
