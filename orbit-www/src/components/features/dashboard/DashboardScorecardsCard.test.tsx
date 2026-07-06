import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DashboardScorecardsCard } from './DashboardScorecardsCard'

describe('DashboardScorecardsCard', () => {
  afterEach(() => { cleanup() })

  const populatedProps = {
    report: {
      avgScore: 72,
      scoredCount: 18,
      entityTotal: 24,
      trend: [
        { capturedAt: 1, avgScore: 60 },
        { capturedAt: 2, avgScore: 65 },
        { capturedAt: 3, avgScore: 72 },
      ],
      worstGroups: [
        { name: 'Platform', avgScore: 41, entityCount: 5 },
        { name: 'Payments', avgScore: 58, entityCount: 3 },
      ],
    },
    openActionItems: 7,
    activeInitiatives: 2,
    hasScorecards: true,
  }

  it('renders the empty state with a CTA to define the first standard when there are no scorecards', () => {
    render(
      <DashboardScorecardsCard
        report={{ avgScore: null, scoredCount: 0, entityTotal: 0, trend: [], worstGroups: [] }}
        openActionItems={0}
        activeInitiatives={0}
        hasScorecards={false}
      />,
    )
    const cta = screen.getByRole('link', { name: /define your first standard/i })
    expect(cta).toHaveAttribute('href', '/scorecards/new')
  })

  it('renders the compliance headline and scored-entity subtitle when populated', () => {
    render(<DashboardScorecardsCard {...populatedProps} />)
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText(/18/)).toBeInTheDocument()
    expect(screen.getByText(/24/)).toBeInTheDocument()
  })

  it('renders an em-dash headline when avgScore is null but scorecards exist', () => {
    render(
      <DashboardScorecardsCard
        report={{ avgScore: null, scoredCount: 0, entityTotal: 24, trend: [], worstGroups: [] }}
        openActionItems={0}
        activeInitiatives={0}
        hasScorecards
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('lists the worst-performing groups', () => {
    render(<DashboardScorecardsCard {...populatedProps} />)
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.getByText('Payments')).toBeInTheDocument()
  })

  it('renders open action-item and active-initiative counts', () => {
    render(<DashboardScorecardsCard {...populatedProps} />)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('links the header to the reports page and the initiatives line to the initiatives page', () => {
    render(<DashboardScorecardsCard {...populatedProps} />)
    expect(screen.getByRole('link', { name: /view reports/i })).toHaveAttribute('href', '/scorecards/reports')
    expect(screen.getByRole('link', { name: /initiative/i })).toHaveAttribute('href', '/scorecards/initiatives')
  })

  it('does not crash when the trend series is empty', () => {
    render(
      <DashboardScorecardsCard
        report={{ avgScore: 50, scoredCount: 1, entityTotal: 1, trend: [], worstGroups: [] }}
        openActionItems={0}
        activeInitiatives={0}
        hasScorecards
      />,
    )
    expect(screen.getByText('50')).toBeInTheDocument()
  })
})
