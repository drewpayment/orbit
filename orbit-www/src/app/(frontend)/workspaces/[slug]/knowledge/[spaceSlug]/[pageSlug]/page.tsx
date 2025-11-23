import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { PageEditor } from '@/components/features/knowledge/PageEditor'
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

  // Fetch all pages for navigation
  const pagesResult = await payload.find({
    collection: 'knowledge-pages',
    where: {
      knowledgeSpace: {
        equals: space.id,
      },
    },
    limit: 1000,
    sort: 'sortOrder',
  })

  const pages = pagesResult.docs

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

        {/* Slim header with breadcrumbs - 40px height */}
        <div className="sticky top-0 z-10 flex h-10 items-center justify-between border-b border-border bg-background px-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              href={`/workspaces/${workspace.slug}/knowledge`}
              className="hover:text-foreground transition-colors"
            >
              Knowledge Base
            </Link>
            <span>/</span>
            <Link
              href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}
              className="hover:text-foreground transition-colors"
            >
              {space.name}
            </Link>
            <span>/</span>
            <span className="text-foreground">{page.title}</span>
          </div>
        </div>

        {/* Main content - full width with generous padding */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-none px-6 sm:px-12 lg:px-24 xl:px-48 py-8 sm:py-12 lg:py-16">
            <article className="stagger-reveal">
              {/* Page Title & Metadata */}
              <div className="mb-12 stagger-item">
                {/* Status badges */}
                {(page.status === 'draft' || page.status === 'archived') && (
                  <div className="mb-4">
                    {page.status === 'draft' && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                      >
                        Draft
                      </Badge>
                    )}
                    {page.status === 'archived' && (
                      <Badge
                        variant="secondary"
                        className="bg-muted text-muted-foreground"
                      >
                        Archived
                      </Badge>
                    )}
                  </div>
                )}

                {/* Title - large serif, will be first editable block in editor */}
                <h1 className="text-[3.5rem] font-bold font-serif-display leading-tight mb-8">
                  {page.title}
                </h1>

                {/* Metadata line - inline, subtle */}
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground font-medium">
                  {author && <span>By {author.name || author.email}</span>}
                  {author && page.updatedAt && <span>·</span>}
                  {page.updatedAt && (
                    <span>
                      Updated{' '}
                      {new Date(page.updatedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                  {lastEditedBy && lastEditedBy.id !== author?.id && (
                    <>
                      <span>·</span>
                      <span>Last edited by {lastEditedBy.name || lastEditedBy.email}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Page Content - always-on editor */}
              <div className="mb-16 stagger-item">
                <PageEditor
                  page={page}
                  canEdit={true}
                  onSave={boundUpdatePage}
                />
              </div>

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
