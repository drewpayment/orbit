import Link from 'next/link'
import { Zap, Plus, Pencil, ArrowRight } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { listAutomations, getManageableAutomationWorkspaces } from './actions'

/**
 * Automations list (IDP refocus P4). Workspace-scoped read; authoring (New /
 * Edit) is gated on workspace owner/admin — the buttons only render when the
 * user manages at least one workspace, and the server actions re-enforce it.
 */
export default async function AutomationsPage() {
  const user = await getCurrentUser()
  const [automations, manageableWorkspaces] = await Promise.all([
    listAutomations(user?.id),
    getManageableAutomationWorkspaces(user?.id),
  ])
  const canManage = manageableWorkspaces.length > 0
  const manageableIds = new Set(manageableWorkspaces.map((w) => w.id))

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Automations</h1>
              <p className="text-muted-foreground mt-2">
                Event-driven rules that run self-service actions when catalog or scorecard state
                changes — including drift detection.
              </p>
            </div>
            {canManage && (
              <Button asChild>
                <Link href="/automations/new">
                  <Plus className="h-4 w-4" />
                  New automation
                </Link>
              </Button>
            )}
          </div>

          {automations.length === 0 ? (
            <Card className="mx-auto max-w-xl">
              <CardHeader className="items-center text-center">
                <Zap className="h-10 w-10 text-muted-foreground" />
                <CardTitle className="mt-2">No automations yet</CardTitle>
                <CardDescription>
                  Connect scorecards to actions: e.g. when a service drifts out of compliance, open a
                  remediation action automatically.
                </CardDescription>
              </CardHeader>
              {canManage && (
                <CardContent className="text-center">
                  <Button asChild variant="outline">
                    <Link href="/automations/new">
                      <Plus className="h-4 w-4" />
                      Create your first automation
                    </Link>
                  </Button>
                </CardContent>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {automations.map((a) => {
                const editable = manageableIds.has(a.workspace)
                return (
                  <Card key={a.id} className="h-full">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <Zap className="h-5 w-5 text-muted-foreground" />
                        <div className="flex items-center gap-2">
                          {!a.enabled && <Badge variant="outline">Disabled</Badge>}
                          {editable && (
                            <Link
                              href={`/automations/${a.id}/edit`}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label="Edit automation"
                            >
                              <Pencil className="h-4 w-4" />
                            </Link>
                          )}
                        </div>
                      </div>
                      <CardTitle className="mt-2 text-base">{a.name}</CardTitle>
                      {a.description && <CardDescription>{a.description}</CardDescription>}
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Badge variant="secondary">{a.event}</Badge>
                        <ArrowRight className="h-3.5 w-3.5" />
                        <span className="truncate">{a.actionName ?? 'Unknown action'}</span>
                      </div>
                      {a.lastTriggeredAt && (
                        <p className="text-xs text-muted-foreground">
                          Last triggered {new Date(a.lastTriggeredAt).toLocaleString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
