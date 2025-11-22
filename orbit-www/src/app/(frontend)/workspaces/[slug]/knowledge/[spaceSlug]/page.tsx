import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'
import { ArrowLeft, FileText } from 'lucide-react'

interface PageProps {
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpacePage({ params }: PageProps) {
  const { slug, spaceSlug } = await params
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

  // Fetch pages for this space
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
  const publishedCount = pages.filter((p) => p.status === 'published').length
  const draftCount = pages.filter((p) => p.status === 'draft').length

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
                {/* Header */}
                <div className="mb-8">
                  <Link
                    href={`/workspaces/${workspace.slug}/knowledge`}
                    className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Knowledge Base
                  </Link>
                  <div className="flex items-start gap-4">
                    {space.icon && <span className="text-5xl">{space.icon}</span>}
                    <div className="flex-1">
                      <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                        {space.name}
                      </h1>
                      {space.description && (
                        <p className="text-lg text-gray-600 dark:text-gray-400">
                          {space.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
                  {/* Left Sidebar - Page Navigation */}
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Pages</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <SpaceNavigator
                          knowledgeSpace={space}
                          pages={pages}
                          workspaceSlug={workspace.slug}
                          userId={undefined} // TODO: Get from auth session
                        />
                      </CardContent>
                    </Card>

                    {/* Stats Card */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Statistics</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            Total Pages
                          </span>
                          <Badge variant="secondary">{pages.length}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Published</span>
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            {publishedCount}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Drafts</span>
                          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                            {draftCount}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Main Content */}
                  <div>
                    <Card>
                      <CardHeader>
                        <CardTitle>Welcome to {space.name}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="prose dark:prose-invert max-w-none">
                          {space.description ? (
                            <p>{space.description}</p>
                          ) : (
                            <p>
                              This knowledge space contains documentation and guides. Select a page
                              from the navigation to get started.
                            </p>
                          )}

                          {pages.length > 0 && (
                            <>
                              <h3 className="mt-8 mb-4">Recent Pages</h3>
                              <ul className="space-y-2">
                                {pages.slice(0, 5).map((page) => (
                                  <li key={page.id}>
                                    <Link
                                      href={`/workspaces/${workspace.slug}/knowledge/${space.slug}/${page.slug}`}
                                      className="text-primary hover:underline flex items-center gap-2"
                                    >
                                      <FileText className="h-4 w-4" />
                                      {page.title}
                                      {page.status === 'draft' && (
                                        <Badge
                                          variant="secondary"
                                          className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                        >
                                          Draft
                                        </Badge>
                                      )}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </SidebarInset>
      </SidebarProvider>
  )
}
