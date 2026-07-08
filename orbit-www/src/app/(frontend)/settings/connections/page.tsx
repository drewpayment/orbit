import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { listConnectionsAdminCore } from '@/lib/connections/connections-core'
import { ConnectionsClient } from '@/components/features/connections/ConnectionsClient'

export const metadata = {
  title: 'Connections — Platform Admin',
  description: 'Azure DevOps organizations connected for catalog discovery.',
}

/**
 * Non-GitHub git provider connections (platform admin, WP11). Manages Azure
 * DevOps connections — create, edit, remove, validate the PAT, and trigger a
 * catalog scan. The PAT is never sent to the client (the projection is
 * PAT-less); editing is write-only.
 */
export default async function ConnectionsSettingsPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) redirect('/')

  const payload = await getPayload({ config })
  const connections = await listConnectionsAdminCore(payload)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-8">
          <ConnectionsClient connections={connections} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
