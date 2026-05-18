import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DashboardHero } from './DashboardHero'

describe('DashboardHero', () => {
  afterEach(() => { cleanup() })

  it('should render morning greeting before noon', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 16, 9, 0, 0))
    render(<DashboardHero userName="Drew" />)
    expect(screen.getByRole('heading', { name: /Good morning,?\s*Drew/i })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render attention summary pill when attentionCount > 0', () => {
    render(<DashboardHero userName="Drew" attentionCount={2} workspaceCount={3} />)
    expect(screen.getByText(/2 agent runs need attention/i)).toBeInTheDocument()
    expect(screen.getByText(/3 workspaces/i)).toBeInTheDocument()
  })

  it('should render "all clear" fallback when no attention needed', () => {
    render(<DashboardHero userName="Drew" attentionCount={0} workspaceCount={3} />)
    expect(screen.getByText(/All clear/i)).toBeInTheDocument()
  })

  it('should render the three action buttons', () => {
    render(<DashboardHero userName="Drew" />)
    expect(screen.getByRole('link', { name: /Browse templates/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ask the agent/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New workspace/i })).toBeInTheDocument()
  })
})
