import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { listConnectionsAdminCore } from '@/lib/connections/connections-core'
import { listInstallationsAdminCore } from '@/lib/github/installations-core'
import { ConnectionsClient } from '@/components/features/connections/ConnectionsClient'
import type { WorkspaceOption } from '@/components/features/connections/WorkspaceAssignmentDialog'

export const metadata = {
  title: 'Connections — Platform Admin',
  description: 'Connect GitHub and Azure DevOps for repository import and catalog discovery.',
}

/**
 * Unified git-provider connections (platform admin). Merges the former GitHub
 * App installations page and Azure DevOps connections
 * into one provider-sectioned page with a single Add flow, consistent verbs,
 * and workspace assignment for both providers. Secrets never round-trip to the
 * client — both loaders return PAT-less / token-less projections.
 */
export default async function ConnectionsSettingsPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) redirect('/')

  const payload = await getPayload({ config })
  const [installations, connections, workspacesResult] = await Promise.all([
    listInstallationsAdminCore(payload),
    listConnectionsAdminCore(payload),
    payload.find({
      collection: 'workspaces',
      limit: 500,
      depth: 0,
      sort: 'name',
      overrideAccess: true,
    }),
  ])

  const workspaces: WorkspaceOption[] = workspacesResult.docs.map((doc) => ({
    id: String((doc as { id: unknown }).id),
    name:
      typeof (doc as { name?: unknown }).name === 'string'
        ? ((doc as { name: string }).name)
        : String((doc as { id: unknown }).id),
  }))

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-8">
          <ConnectionsClient
            installations={installations}
            connections={connections}
            workspaces={workspaces}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
