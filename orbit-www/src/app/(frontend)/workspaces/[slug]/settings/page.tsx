import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { WorkspaceSettingsClient } from './settings-client'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function WorkspaceSettingsPage({ params }: PageProps) {
  const { slug } = await params
  const payload = await getPayload({ config })

  // Get current user session
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/sign-in')
  }

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
    depth: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Check if user is admin/owner
  const memberResult = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (!memberResult.docs.length) {
    redirect(`/workspaces/${slug}`)
  }

  const member = memberResult.docs[0]
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
