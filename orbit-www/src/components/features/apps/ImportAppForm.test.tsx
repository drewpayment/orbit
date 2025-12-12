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

    // Change workspace - use getAllByText and select the one in the dropdown content
    await user.click(screen.getByRole('combobox', { name: /workspace/i }))
    const platformOptions = screen.getAllByText('Platform')
    // Click the one in the select content (usually the last one when dropdown is open)
    await user.click(platformOptions[platformOptions.length - 1])

    await waitFor(() => {
      expect(getWorkspaceGitHubInstallations).toHaveBeenCalledWith('ws-2')
    })
  })
})
