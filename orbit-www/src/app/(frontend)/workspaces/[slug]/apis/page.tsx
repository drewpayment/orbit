import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getWorkspaceAPIs } from './actions'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { WorkspaceAPIsClient } from './workspace-apis-client'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { getCurrentUser } from '@/lib/auth/session'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function WorkspaceAPIsPage({ params }: PageProps) {
  const { slug } = await params
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Get workspace by slug
  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })

  const workspace = workspaces.docs[0]
  if (!workspace) {
    notFound()
  }

  const apis = await getWorkspaceAPIs(workspace.id)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">APIs</h1>
              <p className="text-muted-foreground">
                Manage OpenAPI specifications for {workspace.name}
              </p>
            </div>
            <Button asChild>
              <Link href={`/workspaces/${slug}/apis/new`}>
                <Plus className="h-4 w-4 mr-2" />
                New API
              </Link>
            </Button>
          </div>

          <WorkspaceAPIsClient
            apis={apis}
            workspaceSlug={slug}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
