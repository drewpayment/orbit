import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionForm } from '@/components/features/actions/ActionForm'
import { getManageableActionWorkspaces } from '../actions'

/**
 * New-action flow (IDP refocus P3). Resolves the workspaces the user may manage
 * (owner/admin) for the workspace picker. When the user can manage none, the
 * page renders a not-permitted notice — defense-in-depth on top of the
 * RBAC-enforced createAction server action.
 */
export default async function NewActionPage() {
  const user = await getCurrentUser()
  const workspaces = await getManageableActionWorkspaces(user?.id)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Self-Service
            </Link>
            <h1 className="text-3xl font-bold">New action</h1>
            <p className="mt-2 text-muted-foreground">
              Define a self-service action: its inputs, approval policy, and how it executes.
            </p>
          </div>

          {workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">You don&rsquo;t have permission to create actions</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Authoring actions requires being an owner or admin of a workspace. Ask a workspace
                owner for access.
              </p>
            </div>
          ) : (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm mode="create" workspaces={workspaces} />
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
