import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardStatsRow } from './DashboardStatsRow'

describe('DashboardStatsRow', () => {
  afterEach(() => { cleanup() })

  const defaultProps = {
    complianceScore: 72,
    scoredCount: 18,
    entityTotal: 24,
    openActionItems: 7,
    pendingApprovals: 3,
    kafkaTopicCount: 47,
    virtualClusterCount: 8,
  }

  it('should render all four stat tiles', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('Compliance')).toBeInTheDocument()
    expect(screen.getByText('Action items')).toBeInTheDocument()
    expect(screen.getByText('Pending approvals')).toBeInTheDocument()
    expect(screen.getByText('Kafka topics')).toBeInTheDocument()
  })

  it('should render stat values', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
  })

  it('should render the scored-entity subtitle on the compliance tile', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText(/18/)).toBeInTheDocument()
    expect(screen.getByText(/24/)).toBeInTheDocument()
  })

  it('should render the virtual cluster summary on the Kafka tile', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    expect(screen.getByText(/virtual cluster/i)).toBeInTheDocument()
  })

  it('should render an em-dash and a no-scorecards subtitle when compliance is null', () => {
    render(<DashboardStatsRow {...defaultProps} complianceScore={null} scoredCount={0} entityTotal={0} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/no scorecards yet/i)).toBeInTheDocument()
  })

  it('should link the compliance tile to reports and the action-items tile to initiatives', () => {
    render(<DashboardStatsRow {...defaultProps} />)
    const links = screen.getAllByRole('link')
    const hrefs = links.map((l) => l.getAttribute('href'))
    expect(hrefs).toContain('/scorecards/reports')
    expect(hrefs).toContain('/scorecards/initiatives')
    expect(hrefs).toContain('/platform/approvals')
    expect(hrefs).toContain('/platform/kafka')
  })
})
