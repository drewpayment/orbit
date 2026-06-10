import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardSection } from './DashboardSection'

describe('DashboardSection', () => {
  afterEach(() => { cleanup() })

  it('should render the section title', () => {
    render(<DashboardSection title="Overview" />)
    expect(screen.getByText('Overview')).toBeInTheDocument()
  })

  it('should render an optional count pill', () => {
    render(<DashboardSection title="My workspaces" count={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('should render a "more" link when href + label provided', () => {
    render(<DashboardSection title="My workspaces" moreLabel="All workspaces" moreHref="/workspaces" />)
    const link = screen.getByRole('link', { name: /All workspaces/i })
    expect(link).toHaveAttribute('href', '/workspaces')
  })

  it('should not render a "more" link by default', () => {
    render(<DashboardSection title="Overview" />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
