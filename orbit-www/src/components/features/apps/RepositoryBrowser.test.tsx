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

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search repositories/i)).toBeInTheDocument()
    })
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
})
