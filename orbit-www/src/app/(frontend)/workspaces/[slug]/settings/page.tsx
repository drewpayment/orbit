import { notFound, redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Separator } from '@/components/ui/separator'
import { WorkspaceSettingsClient } from './settings-client'
import {
  getSession,
  getWorkspaceBySlug,
  getWorkspaceMembership,
} from '@/lib/data/cached-queries'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function WorkspaceSettingsPage({ params }: PageProps) {
  const { slug } = await params

  // Use cached fetchers for request-level deduplication
  const session = await getSession()
  if (!session?.user) {
    redirect('/sign-in')
  }

  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  // Check if user is admin/owner
  const member = await getWorkspaceMembership(workspace.id, session.user.id)
  if (!member) {
    redirect(`/workspaces/${slug}`)
  }

  const isAdmin = member.role === 'owner' || member.role === 'admin'
  if (!isAdmin) {
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
