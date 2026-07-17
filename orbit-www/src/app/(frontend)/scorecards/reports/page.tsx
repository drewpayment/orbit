import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { ReportView } from '@/components/features/scorecards/reports/ReportView'
import { getReportWorkspaceOptions, getScorecardReport, type ReportWorkspaceOption } from './actions'

/**
 * Scorecard Reports & Insights (docs/plans/2026-07-01-scorecard-reports.md,
 * WP3): the measurement layer for scorecards — org KPIs, score distribution,
 * team/kind breakdowns, per-scorecard rule insights, and a trend line, all
 * bounded to the current user's workspace memberships. Linked from the
 * `/scorecards` page header.
 */

const DEFAULT_WINDOW_DAYS = 30

async function ReportContent({
  workspaceId,
  workspaces,
}: {
  workspaceId: string
  workspaces: ReportWorkspaceOption[]
}) {
  const report = await getScorecardReport(workspaceId, DEFAULT_WINDOW_DAYS)
  return (
    <ReportView
      key={workspaceId}
      initialReport={report}
      initialWindowDays={DEFAULT_WINDOW_DAYS}
      workspaces={workspaces}
    />
  )
}

export default async function ScorecardReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>
}) {
  const [params, workspaces] = await Promise.all([searchParams, getReportWorkspaceOptions()])
  const requestedWorkspace = params.workspace
  const workspaceId =
    workspaces.find((workspace) => workspace.id === requestedWorkspace)?.id ?? workspaces[0]?.id ?? ''

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/scorecards"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Scorecards
            </Link>
            <h1 className="text-3xl font-bold">Reports</h1>
            <p className="mt-2 text-muted-foreground">
              Workspace standards health: are we getting better, which teams are behind, and which
              standards are failing.
            </p>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ReportContent workspaceId={workspaceId} workspaces={workspaces} />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
