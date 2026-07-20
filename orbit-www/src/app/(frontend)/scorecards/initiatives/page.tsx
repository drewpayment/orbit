import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, Target } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { InitiativeCard } from '@/components/features/scorecards/initiatives/InitiativeCard'
import { getManageableWorkspaces } from '../actions'
import { listInitiatives } from './actions'

/**
 * Initiatives landing (Initiatives UI, docs/plans/2026-07-02-initiatives-ui.md).
 *
 * Lists the workspace's initiatives as cards — each carrying its scorecard,
 * target level, status, deadline (overdue flagged) and live progress — so an
 * engineering leader can see every improvement campaign at a glance. Linked from
 * the `/scorecards` header. Cards deep-link to `/scorecards/initiatives/{id}`.
 */
async function InitiativesContent() {
  const initiatives = await listInitiatives()

  if (initiatives.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Target className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">No initiatives yet</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Initiatives drive entities up a scorecard ladder by a deadline. Pick a scorecard and
          target level and Orbit generates an action item for every failing rule, then keeps them in
          sync as you re-evaluate.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {initiatives.map((initiative) => (
        <InitiativeCard key={initiative.id} initiative={initiative} />
      ))}
    </div>
  )
}

/**
 * "New initiative" CTA — rendered only for owners/admins of at least one
 * workspace (matches the createInitiative RBAC gate). Streams in its own
 * Suspense boundary so resolving the manageable workspaces never blocks the
 * page header.
 */
async function NewInitiativeButton() {
  const workspaces = await getManageableWorkspaces()
  if (workspaces.length === 0) return null
  return (
    <Button asChild size="sm">
      <Link href="/scorecards/initiatives/new">
        <Plus className="h-4 w-4" />
        New initiative
      </Link>
    </Button>
  )
}

export default function InitiativesPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                href="/scorecards"
                className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Scorecards
              </Link>
              <h1 className="text-3xl font-bold">Initiatives</h1>
              <p className="mt-2 text-muted-foreground">
                Time-boxed campaigns to raise scorecard compliance — measure, then improve.
              </p>
            </div>
            <Suspense fallback={null}>
              <NewInitiativeButton />
            </Suspense>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <InitiativesContent />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
