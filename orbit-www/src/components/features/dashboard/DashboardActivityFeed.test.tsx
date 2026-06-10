import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardActivityFeed } from './DashboardActivityFeed'
import type { Activity } from './DashboardActivityFeed'

describe('DashboardActivityFeed', () => {
  afterEach(() => { cleanup() })

  const now = Date.now()
  const mockActivities: Activity[] = [
    { type: 'app', title: 'App deployed', description: 'payment-service v2.4.1 deployed', timestamp: new Date(now - 2 * 60 * 1000).toISOString() },
    { type: 'topic', title: 'Topic created', description: 'orders.completed in Engineering cluster', timestamp: new Date(now - 15 * 60 * 1000).toISOString() },
    { type: 'schema', title: 'Schema registered', description: 'user-events-v3.avsc added', timestamp: new Date(now - 26 * 60 * 60 * 1000).toISOString() },
    { type: 'doc', title: 'Doc updated', description: 'Kafka troubleshooting guide revised', timestamp: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() },
  ]

  it('should render activity titles', () => {
    render(<DashboardActivityFeed activities={mockActivities} />)
    expect(screen.getByText('App deployed')).toBeInTheDocument()
    expect(screen.getByText('Topic created')).toBeInTheDocument()
    expect(screen.getByText('Schema registered')).toBeInTheDocument()
    expect(screen.getByText('Doc updated')).toBeInTheDocument()
  })

  it('should render activity descriptions', () => {
    render(<DashboardActivityFeed activities={mockActivities} />)
    expect(screen.getByText('payment-service v2.4.1 deployed')).toBeInTheDocument()
  })

  it('should group items by day with section labels', () => {
    render(<DashboardActivityFeed activities={mockActivities} />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    // Yesterday or Earlier should appear depending on the rolling timestamps.
    const yesterdayOrEarlier =
      screen.queryByText('Yesterday') ?? screen.queryByText('Earlier')
    expect(yesterdayOrEarlier).not.toBeNull()
  })

  it('should render empty state when no activities', () => {
    render(<DashboardActivityFeed activities={[]} />)
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument()
  })
})
