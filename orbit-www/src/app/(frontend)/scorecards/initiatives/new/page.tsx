import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InitiativeForm } from '@/components/features/scorecards/initiatives/InitiativeForm'
import { getManageableWorkspaces } from '../../actions'
import { listScorecardOptions } from '../actions'

/**
 * New-initiative flow. Resolves the caller's manageable workspaces (owner/admin)
 * as a defense-in-depth gate on top of the RBAC-enforced createInitiative action,
 * and the scorecards they can target. Empty states cover both "can't author" and
 * "no scorecards to target yet".
 */
export default async function NewInitiativePage() {
  const [workspaces, scorecards] = await Promise.all([
    getManageableWorkspaces(),
    listScorecardOptions(),
  ])

  const canManage = workspaces.length > 0

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/scorecards/initiatives"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Initiatives
            </Link>
            <h1 className="text-3xl font-bold">New initiative</h1>
            <p className="mt-2 text-muted-foreground">
              Target a scorecard level by a deadline. Orbit generates an action item for every
              failing rule at or below that level.
            </p>
          </div>

          {!canManage ? (
            <NotPermitted />
          ) : scorecards.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">No scorecards to target</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Create a scorecard with a maturity ladder first, then come back to launch an
                initiative against it.
              </p>
            </div>
          ) : (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <InitiativeForm scorecards={scorecards} />
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function NotPermitted() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="text-lg font-semibold">You can&rsquo;t create initiatives</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Launching an initiative requires being an owner or admin of a workspace. Ask a workspace
        owner for access.
      </p>
    </div>
  )
}
