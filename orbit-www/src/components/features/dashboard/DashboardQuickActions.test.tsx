import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardQuickActions } from './DashboardQuickActions'

describe('DashboardQuickActions', () => {
  afterEach(() => { cleanup() })

  it('should render all action items', () => {
    render(<DashboardQuickActions />)
    expect(screen.getByText('New workspace')).toBeInTheDocument()
    expect(screen.getByText('Ask the agent')).toBeInTheDocument()
    expect(screen.getByText('Create application')).toBeInTheDocument()
    expect(screen.getByText('Request topic')).toBeInTheDocument()
    expect(screen.getByText('Register schema')).toBeInTheDocument()
    expect(screen.getByText('Invite member')).toBeInTheDocument()
  })

  it('should render keyboard shortcut hints', () => {
    render(<DashboardQuickActions />)
    expect(screen.getByText('⌘ K')).toBeInTheDocument()
    expect(screen.getByText('⌘ ⇧ N')).toBeInTheDocument()
  })

  it('should render a link for each action', () => {
    render(<DashboardQuickActions />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(6)
  })
})
