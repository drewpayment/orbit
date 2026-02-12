import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DashboardGreeting } from './DashboardGreeting'

describe('DashboardGreeting', () => {
  afterEach(() => { cleanup() })

  it('should render morning greeting before noon', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0, 0)) // 9 AM
    render(<DashboardGreeting userName="Drew" />)
    expect(screen.getByText('Good morning, Drew')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render afternoon greeting between noon and 5pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 14, 0, 0)) // 2 PM
    render(<DashboardGreeting userName="Drew" />)
    expect(screen.getByText('Good afternoon, Drew')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render evening greeting after 5pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 20, 0, 0)) // 8 PM
    render(<DashboardGreeting userName="Drew" />)
    expect(screen.getByText('Good evening, Drew')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('should render fallback when no userName provided', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 1, 11, 9, 0, 0))
    render(<DashboardGreeting userName="" />)
    expect(screen.getByText('Good morning')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
