import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardAppHealthCard } from './DashboardAppHealthCard'

describe('DashboardAppHealthCard', () => {
  afterEach(() => { cleanup() })

  const mockApps = [
    {
      id: '1',
      name: 'payment-service',
      status: 'healthy',
      workspace: { id: 'ws1', name: 'Engineering', slug: 'engineering' },
      latestBuild: { imageTag: 'v2.4.1' },
    },
    {
      id: '2',
      name: 'user-auth-api',
      status: 'degraded',
      workspace: { id: 'ws2', name: 'Digital', slug: 'digital' },
      latestBuild: { imageTag: 'v1.8.0' },
    },
    {
      id: '3',
      name: 'order-processor',
      status: 'healthy',
      workspace: { id: 'ws1', name: 'Engineering', slug: 'engineering' },
      latestBuild: { imageTag: 'v3.1.2' },
    },
  ] as any[]

  it('should render card title', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getByText('Application Health')).toBeInTheDocument()
  })

  it('should render app names', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getByText('payment-service')).toBeInTheDocument()
    expect(screen.getByText('user-auth-api')).toBeInTheDocument()
    expect(screen.getByText('order-processor')).toBeInTheDocument()
  })

  it('should render health status badges', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    const healthyBadges = screen.getAllByText('healthy')
    expect(healthyBadges).toHaveLength(2)
    expect(screen.getByText('degraded')).toBeInTheDocument()
  })

  it('should render workspace name and version in metadata', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getAllByText(/Engineering/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/v2\.4\.1/)).toBeInTheDocument()
  })

  it('should render empty state when no apps', () => {
    render(<DashboardAppHealthCard apps={[]} />)
    expect(screen.getByText(/no applications/i)).toBeInTheDocument()
  })
})
