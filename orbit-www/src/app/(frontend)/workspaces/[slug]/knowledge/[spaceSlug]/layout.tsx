import { notFound, redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { KnowledgeTreeSidebar } from '@/components/features/knowledge/KnowledgeTreeSidebar'
import {
  getWorkspaceBySlug,
  getKnowledgeSpaceBySlug,
  getKnowledgePagesBySpace,
  getActor,
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

  const actor = await getActor()
  if (!actor) {
    redirect('/login')
  }

  // Use cached fetchers for request-level deduplication
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  // Access-checked: returns null for non-members of the workspace.
  const space = await getKnowledgeSpaceBySlug(spaceSlug, workspace.id)

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
          />

          <div className="flex-1 flex flex-col">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
