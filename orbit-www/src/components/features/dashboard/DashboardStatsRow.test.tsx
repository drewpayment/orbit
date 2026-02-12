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

  it('should render health breakdown for apps', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('19 healthy')).toBeInTheDocument()
    expect(screen.getByText('4 degraded')).toBeInTheDocument()
  })

  it('should render virtual cluster count', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('8 virtual clusters')).toBeInTheDocument()
  })

  it('should render published API count', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('9 published')).toBeInTheDocument()
  })

  it('should handle zero counts gracefully', () => {
    render(<DashboardStatsRow {...defaultProps} workspaceCount={0} appCount={0} kafkaTopicCount={0} apiSchemaCount={0} />)
    const zeros = screen.getAllByText('0')
    expect(zeros).toHaveLength(4)
  })
})
