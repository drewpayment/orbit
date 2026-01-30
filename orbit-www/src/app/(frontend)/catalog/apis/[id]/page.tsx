import { notFound } from 'next/navigation'
import { getAPIById, getAPIVersions } from '../actions'
import { APIDetailClient } from './api-detail-client'
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

  // Check if user can edit (creator or workspace member)
  let canEdit = false
  if (user) {
    const createdById = typeof api.createdBy === 'object'
      ? api.createdBy.id
      : api.createdBy
    canEdit = createdById === user.id
    // TODO: Also check workspace membership for owner/admin/member
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <APIDetailClient
            api={api}
            versions={versions}
            canEdit={canEdit}
            userId={user?.id}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
