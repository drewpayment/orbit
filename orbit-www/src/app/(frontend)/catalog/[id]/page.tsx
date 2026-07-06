import { notFound } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { getCatalogEntityDetail } from './actions'
import { EntityDetail } from '@/components/features/catalog/EntityDetail'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CatalogEntityDetailPage({ params }: PageProps) {
  const { id } = await params

  const data = await getCatalogEntityDetail(id)
  if (!data) {
    notFound()
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <EntityDetail
            entity={data.entity}
            relations={data.relations}
            docs={data.docs}
            canManage={data.canManage}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
