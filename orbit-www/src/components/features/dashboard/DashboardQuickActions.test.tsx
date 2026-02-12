import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardQuickActions } from './DashboardQuickActions'

describe('DashboardQuickActions', () => {
  afterEach(() => { cleanup() })

  it('should render card title', () => {
    render(<DashboardQuickActions />)
    expect(screen.getByText('Quick Actions')).toBeInTheDocument()
  })

  it('should render all 5 action items', () => {
    render(<DashboardQuickActions />)
    expect(screen.getByText('Create Application')).toBeInTheDocument()
    expect(screen.getByText('Request Kafka Topic')).toBeInTheDocument()
    expect(screen.getByText('Register API Schema')).toBeInTheDocument()
    expect(screen.getByText('Write Documentation')).toBeInTheDocument()
    expect(screen.getByText('Use Template')).toBeInTheDocument()
  })

  it('should render links for each action', () => {
    render(<DashboardQuickActions />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(5)
  })
})
