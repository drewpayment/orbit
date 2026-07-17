'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/scorecards/reporting'
import {
  getScorecardReport,
  type ReportWorkspaceOption,
  type ScorecardReport,
} from '@/app/(frontend)/scorecards/reports/actions'
import { KpiRow } from './KpiRow'
import { TrendChart } from './TrendChart'
import { ScoreBandsCard } from './ScoreBandsCard'
import { BreakdownTabs } from './BreakdownTabs'
import { ScorecardSection } from './ScorecardSection'
import { ReportEmptyState } from './ReportEmptyState'

const AUTO_REFRESH_MS = 60_000
/** How often the "Updated <relative time>" caption re-renders on its own, with
 *  no network call — just enough to keep "just now" -> "5m ago" moving. */
const FRESHNESS_TICK_MS = 30_000

/**
 * The reports page's client-side orchestrator (UAC-6): owns the selected
 * trend window, holds the current report, and re-fetches on a Refresh click,
 * a window-segment change, or a 60s auto-refresh timer that only runs while
 * the tab is visible (paused on `visibilitychange` and cleaned up on
 * unmount). The initial `report` comes from the server page's first fetch so
 * the page has data on first paint with no client round-trip.
 */
export function ReportView({
  initialReport,
  initialWindowDays,
  workspaces,
}: {
  initialReport: ScorecardReport
  initialWindowDays: number
  workspaces: ReportWorkspaceOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceId = initialReport.workspaceId
  const [report, setReport] = useState(initialReport)
  const [windowDays, setWindowDays] = useState(initialWindowDays)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const refreshSequence = useRef(0)

  // Always-current ref so the interval/visibility callbacks below can read
  // the latest `windowDays` without re-registering the interval every time
  // it changes (the effect that owns the interval only depends on nothing).
  const windowDaysRef = useRef(windowDays)
  windowDaysRef.current = windowDays

  useEffect(() => {
    // Invalidate requests started for the previous workspace before applying
    // new server props, and keep the window label aligned with the payload.
    refreshSequence.current++
    setReport(initialReport)
    setWindowDays(initialReport.windowDays)
  }, [initialReport])

  const refresh = useCallback(async (days: number) => {
    const sequence = ++refreshSequence.current
    setRefreshing(true)
    setRefreshError(null)
    try {
      const next = await getScorecardReport(workspaceId, days)
      if (sequence === refreshSequence.current && next.workspaceId === workspaceId) {
        setReport(next)
      }
    } catch (error) {
      if (sequence === refreshSequence.current) {
        setRefreshError(error instanceof Error ? error.message : 'Unable to refresh the report.')
      }
    } finally {
      if (sequence === refreshSequence.current) setRefreshing(false)
    }
  }, [workspaceId])

  function handleWorkspaceChange(nextWorkspaceId: string) {
    refreshSequence.current++
    const params = new URLSearchParams(searchParams.toString())
    params.set('workspace', nextWorkspaceId)
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleWindowDaysChange(days: number) {
    setWindowDays(days)
    void refresh(days)
  }

  function handleRefreshClick() {
    void refresh(windowDaysRef.current)
  }

  // Freshness caption tick — local only, no fetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // 60s auto-refresh, paused while the tab is hidden.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null

    function start() {
      if (intervalId) return
      intervalId = setInterval(() => {
        void refresh(windowDaysRef.current)
      }, AUTO_REFRESH_MS)
    }
    function stop() {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refresh])

  const hasScorecards = report.scorecards.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium text-foreground">
            Workspace
            <select
              className="h-8 min-w-48 rounded-md border border-input bg-background px-2 text-sm"
              value={workspaceId}
              onChange={(event) => handleWorkspaceChange(event.target.value)}
              disabled={workspaces.length === 0}
            >
              {workspaces.length === 0 ? (
                <option value="">No workspace available</option>
              ) : (
                workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <span className="pb-1.5">
            {report.dataAsOf
              ? `Data as of ${formatRelativeTime(report.dataAsOf, now)}`
              : 'No evaluated data yet'}
            {' · '}Refreshed {formatRelativeTime(report.generatedAt, now)}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={handleRefreshClick}
          disabled={refreshing}
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
          />
          Refresh
        </Button>
      </div>

      {refreshError && (
        <p role="alert" className="text-sm text-destructive">
          {refreshError}
        </p>
      )}

      <KpiRow kpis={report.kpis} />

      <TrendChart
        trend={report.trend}
        windowDays={windowDays}
        onWindowDaysChange={handleWindowDaysChange}
      />

      <ScoreBandsCard bands={report.bands} />

      <BreakdownTabs byTeam={report.byTeam} byKind={report.byKind} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Per-scorecard insights</h2>
        {hasScorecards ? (
          <div className="space-y-4">
            {report.scorecards.map((section) => (
              <ScorecardSection key={section.scorecardId} section={section} />
            ))}
          </div>
        ) : (
          <ReportEmptyState className="rounded-lg border border-dashed">
            No enabled scorecards yet — create one to see its rule and entity insights here.
          </ReportEmptyState>
        )}
      </section>
    </div>
  )
}
