import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseGitHubUrl,
  fetchRepoInfo,
  fetchManifestContent,
  fileExists,
} from './github-manifest'

// Create mock repos object
const mockRepos = {
  get: vi.fn(),
  getContent: vi.fn(),
}

// Mock Octokit
vi.mock('@octokit/rest', () => {
  return {
    Octokit: vi.fn(() => ({
      repos: mockRepos,
    })),
  }
})

describe('parseGitHubUrl', () => {
  it('should parse HTTPS URL', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('should parse HTTPS URL with .git suffix', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo.git')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('should parse SSH URL', () => {
    const result = parseGitHubUrl('git@github.com:owner/repo.git')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('should parse SSH URL without .git', () => {
    const result = parseGitHubUrl('git@github.com:owner/repo')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('should return null for invalid URL', () => {
    const result = parseGitHubUrl('not-a-github-url')
    expect(result).toBeNull()
  })

  it('should return null for empty string', () => {
    const result = parseGitHubUrl('')
    expect(result).toBeNull()
  })
})

describe('fetchRepoInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch repository info successfully', async () => {
    mockRepos.get.mockResolvedValue({
      data: {
        default_branch: 'main',
        is_template: true,
        description: 'Test repo description',
      },
    })

    const result = await fetchRepoInfo('https://github.com/owner/repo', 'test-token')

    expect(result).toEqual({
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
      isTemplate: true,
      description: 'Test repo description',
    })
  })

  it('should handle missing is_template field', async () => {
    mockRepos.get.mockResolvedValue({
      data: {
        default_branch: 'main',
        description: 'Test repo',
      },
    })

    const result = await fetchRepoInfo('https://github.com/owner/repo', 'test-token')

    expect(result?.isTemplate).toBe(false)
  })

  it('should handle null description', async () => {
    mockRepos.get.mockResolvedValue({
      data: {
        default_branch: 'main',
        is_template: false,
        description: null,
      },
    })

    const result = await fetchRepoInfo('https://github.com/owner/repo', 'test-token')

    expect(result?.description).toBeNull()
  })

  it('should return null for invalid URL', async () => {
    const result = await fetchRepoInfo('not-a-url', 'test-token')
    expect(result).toBeNull()
  })

  it('should return null on API error', async () => {
    mockRepos.get.mockRejectedValue(new Error('API Error'))

    const result = await fetchRepoInfo('https://github.com/owner/repo', 'test-token')
    expect(result).toBeNull()
  })
})

describe('fetchManifestContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch and decode base64 content', async () => {
    const content = 'manifest content'
    const base64Content = Buffer.from(content).toString('base64')

    mockRepos.getContent.mockResolvedValue({
      data: {
        content: base64Content,
        encoding: 'base64',
      },
    })

    const result = await fetchManifestContent(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBe(content)
  })

  it('should return null for non-base64 encoding', async () => {
    mockRepos.getContent.mockResolvedValue({
      data: {
        content: 'some content',
        encoding: 'utf-8',
      },
    })

    const result = await fetchManifestContent(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBeNull()
  })

  it('should return null for directory response', async () => {
    mockRepos.getContent.mockResolvedValue({
      data: [
        { name: 'file1.txt', type: 'file' },
        { name: 'file2.txt', type: 'file' },
      ],
    })

    const result = await fetchManifestContent(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBeNull()
  })

  it('should return null on API error', async () => {
    mockRepos.getContent.mockRejectedValue(new Error('File not found'))

    const result = await fetchManifestContent(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBeNull()
  })
})

describe('fileExists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return true if file exists', async () => {
    mockRepos.getContent.mockResolvedValue({
      data: { content: 'some content' },
    })

    const result = await fileExists(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBe(true)
  })

  it('should return false if file does not exist', async () => {
    mockRepos.getContent.mockRejectedValue(new Error('Not found'))

    const result = await fileExists(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBe(false)
  })

  it('should return false on any API error', async () => {
    mockRepos.getContent.mockRejectedValue(new Error('Rate limit exceeded'))

    const result = await fileExists(
      'owner',
      'repo',
      'main',
      '.orbit-manifest.yaml',
      'test-token'
    )

    expect(result).toBe(false)
  })
})
