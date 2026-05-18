import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardAppHealthCard } from './DashboardAppHealthCard'
import type { App } from '@/payload-types'

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
  ] as unknown as App[]

  it('should render the panel title', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getByText('Application health')).toBeInTheDocument()
  })

  it('should render app names', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getByText('payment-service')).toBeInTheDocument()
    expect(screen.getByText('user-auth-api')).toBeInTheDocument()
    expect(screen.getByText('order-processor')).toBeInTheDocument()
  })

  it('should render workspace name in metadata', () => {
    render(<DashboardAppHealthCard apps={mockApps} />)
    expect(screen.getAllByText('Engineering').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Digital')).toBeInTheDocument()
  })

  it('should render empty state when no apps', () => {
    render(<DashboardAppHealthCard apps={[]} />)
    expect(screen.getByText(/no applications/i)).toBeInTheDocument()
  })
})
