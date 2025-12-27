import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TopicDetailClient } from './topic-detail-client'

interface PageProps {
  params: Promise<{
    slug: string
    topicId: string
  }>
}

export default async function TopicDetailPage({ params }: PageProps) {
  const { slug, topicId } = await params
  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
            <TopicDetailClient
              workspaceId={workspace.id as string}
              workspaceSlug={slug}
              topicId={topicId}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
