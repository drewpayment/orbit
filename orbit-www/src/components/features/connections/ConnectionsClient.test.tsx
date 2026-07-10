import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ConnectionsClient } from './ConnectionsClient'
import type { AdminInstallationView } from '@/lib/github/installations-core'
import type { AdminConnectionView } from '@/lib/connections/connections-core'

// Server-only modules the cards import — stub so the tree renders in jsdom.
vi.mock('@/app/actions/github-installations', () => ({
  refreshInstallationToken: vi.fn(),
  getInstallationRefreshState: vi.fn(),
  getInstallationAppCount: vi.fn(),
  deleteInstallationAdmin: vi.fn(),
  updateInstallationWorkspaces: vi.fn(),
}))
vi.mock('@/app/actions/git-connections', () => ({
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  validateConnection: vi.fn(),
  startConnectionScan: vi.fn(),
}))
vi.mock('@/app/actions/discovery', () => ({
  startInstallationScan: vi.fn(),
}))
vi.mock('@/app/actions/github-install', () => ({
  createGithubInstallUrl: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => cleanup())

const ghInstall: AdminInstallationView = {
  id: 'inst-1',
  installationId: '12345',
  accountLogin: 'acme-org',
  status: 'active',
  tokenExpiresAt: '2030-01-01T00:00:00.000Z',
  tokenExpired: false,
  repositorySelection: 'all',
  selectedRepositoryCount: 0,
  allowedWorkspaces: [],
  lastFailureReason: null,
  updatedAt: null,
}

const adoConn: AdminConnectionView = {
  id: 'conn-1',
  name: 'Acme ADO',
  provider: 'azure-devops',
  organization: 'acme',
  project: '',
  baseUrl: 'https://dev.azure.com',
  status: 'active',
  lastValidatedAt: null,
  lastError: null,
  patSet: false,
  authType: 'service-principal',
  tenantId: 't',
  clientId: 'c',
  secretSet: true,
  allowedWorkspaces: [],
  updatedAt: null,
}

const workspaces = [
  { id: 'ws-1', name: 'Platform' },
  { id: 'ws-2', name: 'Payments' },
]

describe('ConnectionsClient', () => {
  it('renders a single global empty state when there are no connections of either provider', () => {
    render(<ConnectionsClient installations={[]} connections={[]} workspaces={workspaces} />)
    expect(screen.getByText('No connections yet')).toBeInTheDocument()
    // Header + empty-state both offer Add connection.
    expect(screen.getAllByRole('button', { name: /Add connection/i }).length).toBeGreaterThan(0)
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument()
    expect(screen.queryByText('Azure DevOps')).not.toBeInTheDocument()
  })

  it('renders only the GitHub section when there are only installations', () => {
    render(<ConnectionsClient installations={[ghInstall]} connections={[]} workspaces={workspaces} />)
    expect(screen.getByRole('heading', { name: 'GitHub', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Azure DevOps', level: 2 })).not.toBeInTheDocument()
    expect(screen.getByText('acme-org')).toBeInTheDocument()
    expect(screen.queryByText('No connections yet')).not.toBeInTheDocument()
  })

  it('renders both sections, GitHub before Azure DevOps', () => {
    render(
      <ConnectionsClient installations={[ghInstall]} connections={[adoConn]} workspaces={workspaces} />,
    )
    const gh = screen.getByRole('heading', { name: 'GitHub', level: 2 })
    const ado = screen.getByRole('heading', { name: 'Azure DevOps', level: 2 })
    expect(gh).toBeInTheDocument()
    expect(ado).toBeInTheDocument()
    // GitHub section appears first in document order.
    expect(gh.compareDocumentPosition(ado) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the provider picker with GitHub and Azure DevOps options on Add connection', () => {
    render(<ConnectionsClient installations={[]} connections={[]} workspaces={workspaces} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Add connection/i })[0])
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Add a connection')).toBeInTheDocument()
    // GitHub option mints a server-issued CSRF state token (WI4) before
    // navigating, so it's a button rather than a static link.
    expect(within(dialog).getByRole('button', { name: /GitHub/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Azure DevOps/i })).toBeInTheDocument()
  })
})
