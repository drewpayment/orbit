import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AutomationForm } from '@/components/features/automations/AutomationForm'
import { getManageableAutomationWorkspaces, getActionsByWorkspace } from '../actions'

/**
 * New-automation flow (IDP refocus P4). Resolves the workspaces the user may
 * manage (owner/admin) + their enabled actions for the picker. When the user can
 * manage none, renders a not-permitted notice — defense-in-depth on top of the
 * RBAC-enforced createAutomation server action.
 */
export default async function NewAutomationPage() {
  const user = await getCurrentUser()
  const workspaces = await getManageableAutomationWorkspaces(user?.id)
  const actionsByWorkspace =
    workspaces.length > 0 ? await getActionsByWorkspace(workspaces.map((w) => w.id)) : {}

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/automations"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Automations
            </Link>
            <h1 className="text-3xl font-bold">New automation</h1>
            <p className="mt-2 text-muted-foreground">
              Pick a trigger, narrow it with a filter, and choose the action to run.
            </p>
          </div>

          {workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">
                You don&rsquo;t have permission to create automations
              </h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Authoring automations requires being an owner or admin of a workspace. Ask a
                workspace owner for access.
              </p>
            </div>
          ) : (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <AutomationForm
                  mode="create"
                  workspaces={workspaces}
                  actionsByWorkspace={actionsByWorkspace}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
