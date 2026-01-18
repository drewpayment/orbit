import { notFound } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { KnowledgeTreeSidebar } from '@/components/features/knowledge/KnowledgeTreeSidebar'
import {
  getWorkspaceBySlug,
  getKnowledgeSpaceBySlug,
  getKnowledgePagesBySpace,
  getPayloadClient,
} from '@/lib/data/cached-queries'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpaceLayout({ children, params }: LayoutProps) {
  const { slug, spaceSlug } = await params

  // Use cached fetchers for request-level deduplication
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  // Fetch user and space in parallel
  const payload = await getPayloadClient()
  const [usersResult, space] = await Promise.all([
    // Fetch a user for temporary auth (TODO: Replace with actual auth session)
    payload.find({
      collection: 'users',
      limit: 1,
    }),
    getKnowledgeSpaceBySlug(spaceSlug, workspace.id),
  ])

  const tempUserId = usersResult.docs[0]?.id

  if (!space) {
    notFound()
  }

  // Use cached fetcher for pages
  const pages = await getKnowledgePagesBySpace(space.id)

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />

        <div className="flex h-[calc(100vh-64px)]">
          <KnowledgeTreeSidebar
            space={space}
            pages={pages}
            workspaceSlug={slug}
            userId={tempUserId}
          />

          <div className="flex-1 flex flex-col">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
