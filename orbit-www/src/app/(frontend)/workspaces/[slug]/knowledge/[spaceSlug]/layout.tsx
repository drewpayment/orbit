import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { KnowledgeTreeSidebar } from '@/components/features/knowledge/KnowledgeTreeSidebar'
import { KnowledgeBreadcrumbs } from '@/components/features/knowledge/KnowledgeBreadcrumbs'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpaceLayout({ children, params }: LayoutProps) {
  const { slug, spaceSlug } = await params
  const payload = await getPayload({ config })

  // Fetch workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch a user for temporary auth (TODO: Replace with actual auth session)
  const usersResult = await payload.find({
    collection: 'users',
    limit: 1,
  })
  const tempUserId = usersResult.docs[0]?.id

  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      slug: { equals: spaceSlug },
      workspace: { equals: workspace.id },
    },
    limit: 1,
  })

  if (!spaceResult.docs.length) {
    notFound()
  }

  const space = spaceResult.docs[0]

  // Fetch pages for this space
  const pagesResult = await payload.find({
    collection: 'knowledge-pages',
    where: { knowledgeSpace: { equals: space.id } },
    limit: 1000,
    sort: 'sortOrder',
  })

  const pages = pagesResult.docs

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
            <KnowledgeBreadcrumbs workspace={workspace} space={space} />

            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
