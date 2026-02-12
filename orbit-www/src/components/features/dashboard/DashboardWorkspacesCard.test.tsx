import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardWorkspacesCard } from './DashboardWorkspacesCard'

describe('DashboardWorkspacesCard', () => {
  afterEach(() => { cleanup() })

  const mockMemberships = [
    {
      id: '1',
      role: 'owner',
      workspace: { id: 'ws1', name: 'Engineering', slug: 'engineering' },
      user: { id: 'u1' },
    },
    {
      id: '2',
      role: 'admin',
      workspace: { id: 'ws2', name: 'Digital', slug: 'digital' },
      user: { id: 'u1' },
    },
    {
      id: '3',
      role: 'member',
      workspace: { id: 'ws3', name: "Alice's Workspace", slug: 'dev1-workspace' },
      user: { id: 'u1' },
    },
  ] as any[]

  it('should render card title', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('My Workspaces')).toBeInTheDocument()
  })

  it('should render workspace names', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Digital')).toBeInTheDocument()
    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument()
  })

  it('should render role badges', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('member')).toBeInTheDocument()
  })

  it('should render workspace links', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    const links = screen.getAllByRole('link')
    const wsLinks = links.filter(l => l.getAttribute('href')?.startsWith('/workspaces/'))
    expect(wsLinks).toHaveLength(3)
  })

  it('should render empty state when no memberships', () => {
    render(<DashboardWorkspacesCard memberships={[]} />)
    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument()
  })

  it('should render View all link', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText(/view all/i)).toBeInTheDocument()
  })
})
