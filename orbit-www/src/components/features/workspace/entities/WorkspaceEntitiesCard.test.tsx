import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WorkspaceEntitiesCard } from './WorkspaceEntitiesCard'
import type { WorkspaceEntitySummary } from './workspace-entities-ui'

afterEach(() => {
  cleanup()
})

const entities: WorkspaceEntitySummary[] = [
  { id: '1', name: 'Checkout Service', kind: 'service' },
  { id: '2', name: 'Payments API', kind: 'api' },
]

describe('WorkspaceEntitiesCard', () => {
  it('shows the empty state with no authoring affordance for a non-member', () => {
    render(<WorkspaceEntitiesCard entities={[]} workspaceId="ws1" isMember={false} />)
    expect(screen.getByText('No entities yet')).toBeInTheDocument()
    expect(screen.queryByText('New entity')).not.toBeInTheDocument()
    expect(screen.queryByText('Create your first entity')).not.toBeInTheDocument()
  })

  it('shows an authoring CTA in the empty state for a member', () => {
    render(<WorkspaceEntitiesCard entities={[]} workspaceId="ws1" isMember />)
    expect(screen.getByText('No entities yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create your first entity' })).toHaveAttribute(
      'href',
      '/catalog/new?workspace=ws1',
    )
  })

  it('groups entities by kind with counts and links to the entity detail page', () => {
    render(<WorkspaceEntitiesCard entities={entities} workspaceId="ws1" isMember={false} />)
    expect(screen.getByText('Services')).toBeInTheDocument()
    expect(screen.getByText('APIs')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Checkout Service' })).toHaveAttribute('href', '/catalog/1')
    expect(screen.getByRole('link', { name: 'Payments API' })).toHaveAttribute('href', '/catalog/2')
  })

  it('does not show "New entity" or the "Create team" callout for a non-member', () => {
    render(<WorkspaceEntitiesCard entities={entities} workspaceId="ws1" isMember={false} />)
    expect(screen.queryByText('New entity')).not.toBeInTheDocument()
    expect(screen.queryByText('Create your team entity')).not.toBeInTheDocument()
  })

  it('shows "New entity" and the "Create team" callout for a member with no team entity', () => {
    render(<WorkspaceEntitiesCard entities={entities} workspaceId="ws1" isMember />)
    expect(screen.getByRole('link', { name: /New entity/ })).toHaveAttribute(
      'href',
      '/catalog/new?workspace=ws1',
    )
    expect(screen.getByText('Create your team entity')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create team' })).toHaveAttribute(
      'href',
      '/catalog/new?workspace=ws1&kind=team',
    )
  })

  it('hides the "Create team" callout once the workspace has a team entity', () => {
    const withTeam: WorkspaceEntitySummary[] = [...entities, { id: '3', name: 'Platform Team', kind: 'team' }]
    render(<WorkspaceEntitiesCard entities={withTeam} workspaceId="ws1" isMember />)
    expect(screen.queryByText('Create your team entity')).not.toBeInTheDocument()
  })

  it('always renders a "View all in catalog" link, filtered to the workspace', () => {
    render(<WorkspaceEntitiesCard entities={entities} workspaceId="ws1" isMember={false} />)
    expect(screen.getByRole('link', { name: /View all in catalog/ })).toHaveAttribute(
      'href',
      '/catalog?workspace=ws1',
    )
  })

  it('renders the total-entity count badge', () => {
    render(<WorkspaceEntitiesCard entities={entities} workspaceId="ws1" isMember={false} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
