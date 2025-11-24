import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { PageContent } from '@/components/features/knowledge/PageContent'
import { KnowledgeBreadcrumbs } from '@/components/features/knowledge/KnowledgeBreadcrumbs'
import { revalidatePath } from 'next/cache'
import type { BlockDocument } from '@/lib/blocks/types'

interface PageProps {
  params: Promise<{
    slug: string
    spaceSlug: string
    pageSlug: string
  }>
}

async function updatePage(pageId: string, workspaceSlug: string, spaceSlug: string, pageSlug: string, content: BlockDocument) {
  'use server'

  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      content,
      contentFormat: 'blocks',
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}/${pageSlug}`)
}

export default async function KnowledgePageView({ params }: PageProps) {
  const { slug, spaceSlug, pageSlug } = await params
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

  // Fetch knowledge space
  const spaceResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      slug: {
        equals: spaceSlug,
      },
      workspace: {
        equals: workspace.id,
      },
    },
    limit: 1,
  })

  if (!spaceResult.docs.length) {
    notFound()
  }

  const space = spaceResult.docs[0]

  // Fetch the specific page
  const pageResult = await payload.find({
    collection: 'knowledge-pages',
    where: {
      slug: {
        equals: pageSlug,
      },
      knowledgeSpace: {
        equals: space.id,
      },
    },
    limit: 1,
    depth: 2,
  })

  if (!pageResult.docs.length) {
    notFound()
  }

  const page = pageResult.docs[0]

  // Get author info
  const author = typeof page.author === 'object' ? page.author : null
  const lastEditedBy = typeof page.lastEditedBy === 'object' ? page.lastEditedBy : null

  // Bind the updatePage server action with the current page's parameters
  const boundUpdatePage = updatePage.bind(null, page.id, workspace.slug, space.slug as string, page.slug)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />

        {/* Breadcrumbs with current page */}
        <KnowledgeBreadcrumbs workspace={workspace} space={space} currentPage={page} />

        {/* Main content - immersive full-width layout */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-none px-12 py-8">
            <article className="stagger-reveal">
              <PageContent
                page={page}
                author={author}
                lastEditedBy={lastEditedBy}
                onSave={boundUpdatePage}
              />

              {/* Tags - inline presentation */}
              {page.tags && page.tags.length > 0 && (
                <div className="mb-16 stagger-item">
                  <div className="text-sm text-muted-foreground mb-3">Tagged with</div>
                  <div className="flex flex-wrap gap-2">
                    {page.tags.map((tag, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="rounded-full px-4 py-1"
                      >
                        {typeof tag === 'string' ? tag : tag.tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Child Pages - clean list */}
              {page.childPages && page.childPages.length > 0 && (
                <div className="stagger-item">
                  <h3 className="text-xl font-semibold font-serif-display mb-6">
                    Pages within {page.title}
                  </h3>
                  <div className="space-y-4">
                    {page.childPages.map((childPage) => {
                      const child = typeof childPage === 'object' ? childPage : null
                      if (!child) return null

                      return (
                        <Link
                          key={child.id}
                          href={`/workspaces/${workspace.slug}/knowledge/${space.slug}/${child.slug}`}
                          className="block group"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="text-foreground font-serif-body group-hover:underline">
                              {child.title}
                            </span>
                            {child.status === 'draft' && (
                              <span className="text-xs text-muted-foreground">
                                (Draft)
                              </span>
                            )}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
            </article>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
