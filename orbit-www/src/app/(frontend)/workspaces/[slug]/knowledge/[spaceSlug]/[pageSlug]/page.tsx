import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'
import { Calendar, User, FileText } from 'lucide-react'
import { serializeLexical } from '@/lib/lexical/serialize'
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

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
                {/* Breadcrumb */}
                <div className="mb-6 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Link
                    href={`/workspaces/${workspace.slug}/knowledge`}
                    className="hover:text-gray-900 dark:hover:text-gray-100"
                  >
                    Knowledge Base
                  </Link>
                  <span>/</span>
                  <Link
                    href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}
                    className="hover:text-gray-900 dark:hover:text-gray-100"
                  >
                    {space.name}
                  </Link>
                  <span>/</span>
                  <span className="text-gray-900 dark:text-gray-100">{page.title}</span>
                </div>

                <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
                  {/* Left Sidebar - Page Navigation */}
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          {space.icon && <span className="text-xl">{space.icon}</span>}
                          <span className="font-semibold">{space.name}</span>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <SpaceNavigator
                          knowledgeSpace={space}
                          pages={pages}
                          currentPageId={page.id}
                          workspaceSlug={workspace.slug}
                          userId={undefined} // TODO: Get from auth session
                        />
                      </CardContent>
                    </Card>
                  </div>

                  {/* Main Content */}
                  <div>
                    <article>
                      {/* Page Header */}
                      <div className="mb-8">
                        <div className="flex items-center gap-2 mb-4">
                          {page.status === 'draft' && (
                            <Badge
                              variant="secondary"
                              className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                            >
                              Draft
                            </Badge>
                          )}
                          {page.status === 'archived' && (
                            <Badge
                              variant="secondary"
                              className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                            >
                              Archived
                            </Badge>
                          )}
                        </div>
                        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                          {page.title}
                        </h1>

                        {/* Meta Info */}
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                          {author && (
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4" />
                              <span>By {author.name || author.email}</span>
                            </div>
                          )}
                          {page.updatedAt && (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span>
                                Updated{' '}
                                {new Date(page.updatedAt).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                          )}
                          {lastEditedBy && lastEditedBy.id !== author?.id && (
                            <div className="flex items-center gap-2">
                              <span>Last edited by {lastEditedBy.name || lastEditedBy.email}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <Separator className="mb-8" />

                      {/* Page Content */}
                      <PageEditor
                        page={page}
                        canEdit={true}
                        onSave={async (content) => {
                          'use server'
                          await updatePage(page.id, workspace.slug, space.slug as string, page.slug, content)
                        }}
                      />

                      {/* Tags */}
                      {page.tags && page.tags.length > 0 && (
                        <>
                          <Separator className="my-8" />
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                              Tags
                            </h3>
                            <div className="flex flex-wrap gap-2">
                              {page.tags.map((tag, index) => (
                                <Badge key={index} variant="secondary">
                                  {typeof tag === 'string' ? tag : tag.tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      {/* Child Pages */}
                      {page.childPages && page.childPages.length > 0 && (
                        <>
                          <Separator className="my-8" />
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                              Sub-pages
                            </h3>
                            <div className="grid gap-3">
                              {page.childPages.map((childPage) => {
                                const child = typeof childPage === 'object' ? childPage : null
                                if (!child) return null

                                return (
                                  <Link
                                    key={child.id}
                                    href={`/workspaces/${workspace.slug}/knowledge/${space.slug}/${child.slug}`}
                                    className="flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  >
                                    <FileText className="h-5 w-5 text-gray-400" />
                                    <div className="flex-1">
                                      <div className="font-medium text-gray-900 dark:text-white">
                                        {child.title}
                                      </div>
                                      {child.status === 'draft' && (
                                        <span className="text-xs text-gray-500">Draft</span>
                                      )}
                                    </div>
                                  </Link>
                                )
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </article>
                  </div>
                </div>
              </div>
            </div>
          </SidebarInset>
      </SidebarProvider>
  )
}
