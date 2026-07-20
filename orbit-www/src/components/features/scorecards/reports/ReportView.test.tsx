import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/scorecards/reports',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/(frontend)/scorecards/reports/actions', () => ({
  getScorecardReport: vi.fn(),
}))
vi.mock('./KpiRow', () => ({ KpiRow: ({ kpis }: { kpis: { avgScore: number } }) => <p>score:{kpis.avgScore}</p> }))
vi.mock('./TrendChart', () => ({
  TrendChart: ({ windowDays }: { windowDays: number }) => <p>window:{windowDays}</p>,
}))
vi.mock('./ScoreBandsCard', () => ({ ScoreBandsCard: () => null }))
vi.mock('./BreakdownTabs', () => ({ BreakdownTabs: () => null }))
vi.mock('./ScorecardSection', () => ({ ScorecardSection: () => null }))
vi.mock('./ReportEmptyState', () => ({ ReportEmptyState: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

import { getScorecardReport, type ScorecardReport } from '@/app/(frontend)/scorecards/reports/actions'
import { ReportView } from './ReportView'

function report(workspaceId: string, avgScore: number, windowDays = 30): ScorecardReport {
  return {
    workspaceId,
    dataAsOf: null,
    generatedAt: '2026-07-16T00:00:00.000Z',
    windowDays,
    kpis: {
      avgScore,
      avgAlignment: 0,
      scoredCount: 0,
      entityTotal: 0,
      activeScorecards: 0,
    },
    bands: [],
    trend: [],
    byTeam: [],
    byKind: [],
    scorecards: [],
  }
}

describe('ReportView workspace refresh isolation', () => {
  it('does not apply an old workspace refresh after new workspace props arrive', async () => {
    let resolveOld!: (value: ScorecardReport) => void
    const oldRefresh = new Promise<ScorecardReport>((resolve) => {
      resolveOld = resolve
    })
    ;(getScorecardReport as Mock).mockReturnValueOnce(oldRefresh)

    const { rerender } = render(
      <ReportView
        initialReport={report('ws1', 10, 90)}
        initialWindowDays={90}
        workspaces={[
          { id: 'ws1', name: 'One' },
          { id: 'ws2', name: 'Two' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    rerender(
      <ReportView
        initialReport={report('ws2', 80)}
        initialWindowDays={30}
        workspaces={[
          { id: 'ws1', name: 'One' },
          { id: 'ws2', name: 'Two' },
        ]}
      />,
    )

    await act(async () => {
      resolveOld(report('ws1', 99))
      await oldRefresh
    })

    expect(screen.getByText('score:80')).toBeInTheDocument()
    expect(screen.getByText('window:30')).toBeInTheDocument()
    expect(screen.queryByText('score:99')).not.toBeInTheDocument()
  })
})
