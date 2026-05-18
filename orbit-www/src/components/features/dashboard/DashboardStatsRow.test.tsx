import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardStatsRow } from './DashboardStatsRow'

describe('DashboardStatsRow', () => {
  afterEach(() => { cleanup() })

  const defaultProps = {
    workspaceCount: 6,
    appCount: 23,
    healthyCount: 19,
    degradedCount: 4,
    unknownCount: 0,
    kafkaTopicCount: 47,
    virtualClusterCount: 8,
    apiSchemaCount: 12,
    publishedApiCount: 9,
  }

  it('should render all four stat cards', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('Applications')).toBeInTheDocument()
    expect(screen.getByText('Kafka Topics')).toBeInTheDocument()
    expect(screen.getByText('API Schemas')).toBeInTheDocument()
  })

  it('should render stat values', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('should render health breakdown labels for apps', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('healthy')).toBeInTheDocument()
    expect(screen.getByText('degraded')).toBeInTheDocument()
  })

  it('should render virtual cluster summary', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText(/virtual cluster/i)).toBeInTheDocument()
  })

  it('should render published API summary', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('published')).toBeInTheDocument()
  })

  it('should render an empty-state CTA when API schema count is zero', () => {
    render(<DashboardStatsRow {...defaultProps} apiSchemaCount={0} publishedApiCount={0} />)
    expect(screen.getByText(/register your first schema/i)).toBeInTheDocument()
  })
})
