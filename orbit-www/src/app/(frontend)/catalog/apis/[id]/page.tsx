import { notFound } from 'next/navigation'
import { getAPIById, getAPIVersions } from '../actions'
import { APIDetailClient } from './api-detail-client'
import type { APISchema, APISchemaVersion } from '@/types/api-catalog'
import { getActor, check, ALL_ROLES } from '@/lib/authz'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function APIDetailPage({ params }: PageProps) {
  const { id } = await params
  const actor = await getActor()

  const [api, versions] = await Promise.all([
    getAPIById(id),
    getAPIVersions(id),
  ])

  if (!api) {
    notFound()
  }

  // Check if user can edit (creator, workspace member with any active role, or
  // platform admin — platform admins are not excluded by the previous check,
  // so `check()`'s bypass is a semantic addition, not a restriction).
  let canEdit = false
  if (actor) {
    const createdById = typeof api.createdBy === 'object'
      ? api.createdBy.id
      : api.createdBy
    const workspaceId = typeof api.workspace === 'string'
      ? api.workspace
      : (api.workspace?.id ?? null)

    const decision = await check(
      'update',
      { kind: 'doc', workspaceId, ownerPayloadId: createdById ?? null, roles: ALL_ROLES },
      actor,
    )
    canEdit = decision.allowed
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
            userId={actor?.payloadId}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
