import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getAPIById, getAPIVersions } from '../actions'
import { APIDetailClient } from './api-detail-client'
import type { APISchema, APISchemaVersion } from '@/types/api-catalog'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function APIDetailPage({ params }: PageProps) {
  const { id } = await params
  const user = await getCurrentUser()

  const [api, versions] = await Promise.all([
    getAPIById(id),
    getAPIVersions(id),
  ])

  if (!api) {
    notFound()
  }

  // Check if user can edit (creator or workspace member with sufficient role)
  let canEdit = false
  if (user) {
    const createdById = typeof api.createdBy === 'object'
      ? api.createdBy.id
      : api.createdBy
    canEdit = createdById === user.id

    if (!canEdit) {
      const workspaceId = typeof api.workspace === 'string'
        ? api.workspace
        : api.workspace?.id
      if (workspaceId) {
        const payload = await getPayload({ config })
        const memberships = await payload.find({
          collection: 'workspace-members',
          where: {
            user: { equals: user.id },
            workspace: { equals: workspaceId },
            status: { equals: 'active' },
            role: { in: ['owner', 'admin', 'member'] },
          },
          limit: 1,
          overrideAccess: true,
        })
        canEdit = memberships.docs.length > 0
      }
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <APIDetailClient
            api={api as unknown as APISchema}
            versions={versions as unknown as APISchemaVersion[]}
            canEdit={canEdit}
            userId={user?.id}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
