import { Suspense } from 'react'
import Link from 'next/link'
import { BarChart3, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { ScorecardCard } from '@/components/features/scorecards/ScorecardCard'
import { listScorecards, getManageableWorkspaces } from './actions'

/**
 * Scorecards landing (IDP refocus P2, issue #45).
 *
 * Lists the workspace's scorecards as cards, each carrying an org rollup (level
 * distribution + pass ratio) — the exec-visibility deliverable. Replaces the P0
 * "Coming soon" placeholder. Cards link to `/scorecards/{id}` for the per-rule,
 * per-entity detail. See docs/plans/2026-06-27-idp-refocus-implementation.md (P2).
 */

async function ScorecardsContent() {
  const user = await getCurrentUser()
  const scorecards = await listScorecards(user?.id)

  if (scorecards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <ShieldCheck className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">No scorecards yet</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Scorecards define standards (owner set, docs linked, on an approved pattern) and grade
          every catalog entity against a maturity ladder. Create one in the admin to start scoring.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {scorecards.map((summary) => (
        <ScorecardCard key={summary.id} summary={summary} />
      ))}
    </div>
  )
}

/**
 * "New scorecard" CTA — rendered only when the user is owner/admin of at least
 * one workspace (matches the createScorecard RBAC gate). Streams in its own
 * Suspense boundary so resolving the manageable workspaces never blocks the
 * page header.
 */
async function NewScorecardButton() {
  const user = await getCurrentUser()
  const workspaces = await getManageableWorkspaces(user?.id)
  if (workspaces.length === 0) return null
  return (
    <Button asChild size="sm">
      <Link href="/scorecards/new">
        <Plus className="h-4 w-4" />
        New scorecard
      </Link>
    </Button>
  )
}

export default function ScorecardsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Scorecards</h1>
              <p className="mt-2 text-muted-foreground">
                Standards enforcement and operational-excellence maturity across every catalog entity.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/scorecards/reports">
                  <BarChart3 className="h-4 w-4" />
                  Reports
                </Link>
              </Button>
              <Suspense fallback={null}>
                <NewScorecardButton />
              </Suspense>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ScorecardsContent />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
