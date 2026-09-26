import { notFound, redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Separator } from '@/components/ui/separator'
import { WorkspaceSettingsClient } from './settings-client'
import { getActor, getWorkspaceBySlug } from '@/lib/data/cached-queries'
import { workspaceRole } from '@/lib/authz'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function WorkspaceSettingsPage({ params }: PageProps) {
  const { slug } = await params

  // Use cached fetchers for request-level deduplication
  const actor = await getActor()
  if (!actor) {
    redirect('/sign-in')
  }

  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  // Owner/admin only (membership, no platform-admin bypass: preserved from the
  // pre-Phase-C page; the settings client actions enforce the policy themselves).
  const role = await workspaceRole(workspace.id, actor)
  if (role !== 'owner' && role !== 'admin') {
    redirect(`/workspaces/${slug}`)
  }

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Workspace Settings</h1>
            <p className="text-muted-foreground">
              Manage settings for {workspace.name}
            </p>
          </div>

          <Separator />

          <WorkspaceSettingsClient
            workspaceId={workspace.id}
            workspaceSlug={slug}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
