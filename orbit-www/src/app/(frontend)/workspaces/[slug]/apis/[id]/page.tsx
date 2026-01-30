import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ArrowLeft } from 'lucide-react'
import { EditAPIClient } from './edit-api-client'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

interface PageProps {
  params: Promise<{ slug: string; id: string }>
}

export default async function EditAPIPage({ params }: PageProps) {
  const { slug, id } = await params
  const payload = await getPayload({ config })
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

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

  // Get the API schema
  const api = await payload.findByID({
    collection: 'api-schemas',
    id,
    depth: 1,
    overrideAccess: true,
  })

  if (!api) {
    notFound()
  }

  // Verify API belongs to this workspace
  const apiWorkspaceId = typeof api.workspace === 'string'
    ? api.workspace
    : api.workspace.id
  if (apiWorkspaceId !== workspace.id) {
    notFound()
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href={`/workspaces/${slug}/apis`}
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to APIs
            </Link>
            <h1 className="text-2xl font-bold">Edit API</h1>
            <p className="text-muted-foreground">
              Update {api.name}
            </p>
          </div>

          <EditAPIClient
            api={api}
            workspaceSlug={slug}
            userId={user.id}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
