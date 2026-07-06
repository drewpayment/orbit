import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardWorkspacesCard } from './DashboardWorkspacesCard'
import type { WorkspaceMember } from '@/payload-types'

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
  ] as unknown as WorkspaceMember[]

  it('should render workspace names', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('Engineering')).toBeInTheDocument()
    expect(screen.getByText('Digital')).toBeInTheDocument()
    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument()
  })

  it('should render role labels', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('member')).toBeInTheDocument()
  })

  it('should render one link per workspace', () => {
    render(<DashboardWorkspacesCard memberships={mockMemberships} />)
    const links = screen.getAllByRole('link')
    const wsLinks = links.filter((l) => l.getAttribute('href')?.startsWith('/workspaces/'))
    expect(wsLinks).toHaveLength(3)
  })

  it('should render dense meta counts from metaById', () => {
    render(
      <DashboardWorkspacesCard
        memberships={mockMemberships}
        metaById={{
          ws1: { apps: 3, topics: 2, schemas: 1, lastActive: '12m ago' },
        }}
      />,
    )
    expect(screen.getByText('3 apps')).toBeInTheDocument()
    expect(screen.getByText('2 topics')).toBeInTheDocument()
    expect(screen.getByText('1 schema')).toBeInTheDocument()
    expect(screen.getByText('12m ago')).toBeInTheDocument()
  })

  it('should render empty state when no memberships', () => {
    render(<DashboardWorkspacesCard memberships={[]} />)
    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument()
  })

  it('should render a degraded indicator when meta.degraded > 0', () => {
    render(
      <DashboardWorkspacesCard
        memberships={mockMemberships}
        metaById={{
          ws1: { apps: 3, topics: 2, schemas: 1, degraded: 2 },
        }}
      />,
    )
    expect(screen.getByText('2 degraded')).toBeInTheDocument()
  })

  it('should not render a degraded indicator when meta.degraded is 0 or absent', () => {
    render(
      <DashboardWorkspacesCard
        memberships={mockMemberships}
        metaById={{
          ws1: { apps: 3, topics: 2, schemas: 1, degraded: 0 },
        }}
      />,
    )
    expect(screen.queryByText(/degraded/)).not.toBeInTheDocument()
  })
})
