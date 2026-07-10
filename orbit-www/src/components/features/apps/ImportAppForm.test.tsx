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

vi.mock('@/app/actions/azure-devops', () => ({
  getWorkspaceGitConnections: vi.fn(),
  listConnectionRepositories: vi.fn(),
  searchConnectionRepositories: vi.fn(),
}))

import { importRepository } from '@/app/actions/apps'
import {
  getWorkspaceGitHubInstallations,
  listInstallationRepositories,
} from '@/app/actions/github'
import {
  getWorkspaceGitConnections,
  listConnectionRepositories,
} from '@/app/actions/azure-devops'

describe('ImportAppForm', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no Azure DevOps connections, so existing assertions exercise the
    // GitHub-only path. ADO-specific tests override this.
    vi.mocked(getWorkspaceGitConnections).mockResolvedValue({ success: true, connections: [] })
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

  it('auto-selects a lone Azure DevOps connection without a source selector', async () => {
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({ success: true, installations: [] })
    vi.mocked(getWorkspaceGitConnections).mockResolvedValue({
      success: true,
      connections: [
        { id: 'conn-1', name: 'Acme ADO', organization: 'acme', baseUrl: 'https://dev.azure.com' },
      ],
    })
    vi.mocked(listConnectionRepositories).mockResolvedValue({
      success: true,
      repos: [
        {
          name: 'backend',
          fullName: 'platform/backend',
          description: null,
          private: true,
          defaultBranch: 'main',
          project: 'platform',
        },
      ],
      hasMore: false,
    })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByText('backend')).toBeInTheDocument()
    })
    // Single provider: no source-selector chrome.
    expect(screen.queryByLabelText(/repository source/i)).not.toBeInTheDocument()
  })

  it('submits an ADO repo with connectionId and a dev.azure.com URL', async () => {
    const user = userEvent.setup()
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({ success: true, installations: [] })
    vi.mocked(getWorkspaceGitConnections).mockResolvedValue({
      success: true,
      connections: [
        { id: 'conn-1', name: 'Acme ADO', organization: 'acme', baseUrl: 'https://dev.azure.com' },
      ],
    })
    vi.mocked(listConnectionRepositories).mockResolvedValue({
      success: true,
      repos: [
        {
          name: 'backend',
          fullName: 'platform/backend',
          description: null,
          private: true,
          defaultBranch: 'main',
          project: 'platform',
        },
      ],
      hasMore: false,
    })
    vi.mocked(importRepository).mockResolvedValue({ success: true, appId: 'app-ado' })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByText('backend')).toBeInTheDocument()
    })

    await user.click(screen.getByText('backend'))
    await user.click(screen.getByRole('button', { name: /import repository/i }))

    await waitFor(() => {
      expect(importRepository).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        repositoryUrl: 'https://dev.azure.com/acme/platform/_git/backend',
        name: 'backend',
        description: '',
        connectionId: 'conn-1',
      })
    })
  })

  it('shows a validation message naming both URL shapes for an unsupported manual URL (ADO source)', async () => {
    const user = userEvent.setup()
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({ success: true, installations: [] })
    vi.mocked(getWorkspaceGitConnections).mockResolvedValue({
      success: true,
      connections: [
        { id: 'conn-1', name: 'Acme ADO', organization: 'acme', baseUrl: 'https://dev.azure.com' },
      ],
    })
    vi.mocked(listConnectionRepositories).mockResolvedValue({ success: true, repos: [], hasMore: false })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    // Lone ADO source is auto-selected; open the manual URL entry.
    await waitFor(() => {
      expect(screen.getByText(/enter a repository url manually/i)).toBeInTheDocument()
    })
    await user.click(screen.getByText(/enter a repository url manually/i))

    await user.type(screen.getByLabelText(/repository url/i), 'https://gitlab.com/foo/bar')
    await user.type(screen.getByLabelText(/application name/i), 'foo')
    await user.click(screen.getByRole('button', { name: /import repository/i }))

    // The inline error names both shapes ("Enter a GitHub …" distinguishes it
    // from the always-present field description "A GitHub …").
    await waitFor(() => {
      expect(screen.getByText(/Enter a GitHub .*Azure DevOps.*_git\/repo/i)).toBeInTheDocument()
    })
    // Rejected client-side — no server round-trip.
    expect(importRepository).not.toHaveBeenCalled()
  })

  it('shows a source selector when both providers are available', async () => {
    vi.mocked(getWorkspaceGitHubInstallations).mockResolvedValue({
      success: true,
      installations: [
        { id: 'install-1', installationId: 12345, accountLogin: 'acme-org', accountAvatarUrl: '', accountType: 'Organization' },
      ],
    })
    vi.mocked(getWorkspaceGitConnections).mockResolvedValue({
      success: true,
      connections: [
        { id: 'conn-1', name: 'Acme ADO', organization: 'acme', baseUrl: 'https://dev.azure.com' },
      ],
    })
    vi.mocked(listConnectionRepositories).mockResolvedValue({ success: true, repos: [], hasMore: false })

    render(<ImportAppForm workspaces={mockWorkspaces} />)

    await waitFor(() => {
      expect(screen.getByLabelText(/repository source/i)).toBeInTheDocument()
    })
  })
})
