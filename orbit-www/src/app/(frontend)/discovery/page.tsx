import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { describeCatalogScanWorkflow } from '@/lib/temporal/client'
import {
  GlobalDiscoveryClient,
  type GlobalInstallation,
  type InstallationScanStatus,
} from '@/components/features/discovery/GlobalDiscoveryClient'
import { listGlobalDiscoveries } from '@/app/actions/discovery'

export const metadata = {
  title: 'Global Discovery — Platform Admin',
  description: 'Scan GitHub installations for services and APIs and import them as global catalog entities.',
}

/**
 * Platform-level (workspace-less) catalog discovery (WP8). Platform admins scan a
 * GitHub installation with no workspace, review the resulting global proposals,
 * and either import them as global catalog entities or assign them to a workspace.
 * Non-admins are redirected, matching the other Platform Admin pages.
 */
export default async function GlobalDiscoveryPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')
  if (!isPlatformAdmin(user)) redirect('/')

  const payload = await getPayload({ config })

  // ALL active installations + workspaces (admin view, membership-independent).
  const [installationsResult, workspacesResult, discoveries] = await Promise.all([
    payload.find({
      collection: 'github-installations',
      where: { status: { equals: 'active' } },
      sort: 'accountLogin',
      limit: 200,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'workspaces',
      sort: 'name',
      limit: 500,
      depth: 0,
      overrideAccess: true,
    }),
    listGlobalDiscoveries(),
  ])

  const installations: GlobalInstallation[] = installationsResult.docs.map((doc) => ({
    id: String(doc.id),
    installationId: String(doc.installationId),
    accountLogin: (doc.accountLogin as string) ?? String(doc.installationId),
  }))

  const workspaces = workspacesResult.docs.map((w) => ({ id: String(w.id), name: w.name as string }))

  // Best-effort scan status per installation for the banner.
  const scanStatuses: InstallationScanStatus[] = await Promise.all(
    installations.map(async (inst) => {
      const status = await describeCatalogScanWorkflow(inst.installationId)
      return { installationId: inst.installationId, status: status.status, lastRunAt: status.lastRunAt }
    }),
  )

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <h1 className="text-2xl font-bold">Global Discovery</h1>
            <p className="text-muted-foreground">
              Scan a GitHub installation for services and APIs without tying them to a workspace.
              Review the proposals, then import each as a global catalog entity or assign it to a
              workspace.
            </p>
          </div>

          <GlobalDiscoveryClient
            installations={installations}
            workspaces={workspaces}
            discoveries={discoveries}
            scanStatuses={scanStatuses}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
