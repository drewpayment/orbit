import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { getActor, check } from '@/lib/authz'
import { DiscoveryClient } from '@/components/features/discovery/DiscoveryClient'
import { listDiscoveries, getScanStatus } from '@/app/actions/discovery'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function WorkspaceDiscoveryPage({ params }: PageProps) {
  const { slug } = await params
  const actor = await getActor()
  if (!actor) redirect('/login')

  const payload = await getPayload({ config })

  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  const workspace = workspaces.docs[0]
  if (!workspace) notFound()

  // Tenant isolation (AC-7): non-members don't see another workspace's queue.
  // (Platform admins now bypass via `check()` — the old membership-only check
  // had no admin exception, so this is a semantic addition, not a restriction.)
  const decision = await check('read', { kind: 'workspace', id: workspace.id }, actor)
  if (!decision.allowed) notFound()

  const [discoveries, scan] = await Promise.all([
    listDiscoveries(workspace.id),
    getScanStatus(workspace.id),
  ])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <h1 className="text-2xl font-bold">Catalog Discovery</h1>
            <p className="text-muted-foreground">
              Scan {workspace.name}&apos;s repositories for services and APIs, then review and import
              the proposals.
            </p>
          </div>

          <DiscoveryClient
            workspaceId={workspace.id}
            workspaceSlug={slug}
            discoveries={discoveries}
            scanStatuses={scan.success ? scan.statuses : []}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
