import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { PageContent } from '@/components/features/knowledge/PageContent'
import { KnowledgeBreadcrumbs } from '@/components/features/knowledge/KnowledgeBreadcrumbs'
import {
  getWorkspaceBySlug,
  getKnowledgeSpaceBySlug,
  getKnowledgePageBySlug,
} from '@/lib/data/cached-queries'
import { updatePageContent } from '@/app/actions/knowledge'
import { getActor, check, MANAGE_ROLES } from '@/lib/authz'

interface PageProps {
  params: Promise<{
    slug: string
    spaceSlug: string
    pageSlug: string
  }>
}

export default async function KnowledgePageView({ params }: PageProps) {
  const { slug, spaceSlug, pageSlug } = await params

  // Use cached fetchers for request-level deduplication
  // These will reuse results from layout.tsx if already fetched
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  const space = await getKnowledgeSpaceBySlug(spaceSlug, workspace.id)
  if (!space) {
    notFound()
  }

  // Use cached fetcher for the page
  const page = await getKnowledgePageBySlug(pageSlug, space.id)
  if (!page) {
    notFound()
  }

  // Get author info
  const author = typeof page.author === 'object' ? page.author : null
  const lastEditedBy = typeof page.lastEditedBy === 'object' ? page.lastEditedBy : null

  // Same rule the knowledge-pages collection enforces on update (and therefore
  // on updatePageContent): the page's author, or a workspace owner/admin
  // (platform admins pass via the policy). Plain members read only; offering
  // them the editor would just produce failed autosaves.
  const actor = await getActor()
  const authorId = page.author && typeof page.author === 'object' ? page.author.id : page.author
  const canEdit = actor
    ? (
        await check(
          'update',
          { kind: 'doc', workspaceId: workspace.id, ownerPayloadId: authorId ?? null, roles: MANAGE_ROLES },
          actor,
        )
      ).allowed
    : false

  // Bind the updatePage server action with the current page's parameters
  const boundUpdatePage = updatePageContent.bind(null, page.id, workspace.slug, space.slug as string, page.slug)

  return (
    <>
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
              canEdit={canEdit}
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
                        <span className="text-foreground font-serif-body group-hover:underline">
                          {child.title}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </article>
        </div>
      </div>
    </>
  )
}
