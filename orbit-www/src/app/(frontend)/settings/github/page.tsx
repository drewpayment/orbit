import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { listInstallationsAdminCore } from '@/lib/github/installations-core'
import { GitHubInstallationsClient } from '@/components/features/github-installations/GitHubInstallationsClient'

export const metadata = {
  title: 'GitHub Installations — Platform Admin',
  description: 'Connection health, token status, and workspace access for GitHub App installations.',
}

/**
 * GitHub App installation management (platform admin). Surfaces the token
 * health that was invisible during the June/July silent-expiry incident, with
 * a manual Refresh action (signal-with-start — restarts a dead refresher),
 * per-installation workspace configuration, and reconnect guidance.
 */
export default async function GitHubSettingsPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) redirect('/')

  const payload = await getPayload({ config })
  const installations = await listInstallationsAdminCore(payload)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <GitHubInstallationsClient installations={installations} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
