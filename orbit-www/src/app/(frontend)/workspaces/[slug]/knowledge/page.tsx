import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { BookOpen, FileText, Lock, Users, Globe } from 'lucide-react'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function KnowledgePage({ params }: PageProps) {
  const { slug } = await params
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

  // Fetch knowledge spaces for this workspace
  const spacesResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    limit: 100,
    sort: 'name',
  })

  const spaces = spacesResult.docs

  // Fetch page counts for each space
  const spaceStats = await Promise.all(
    spaces.map(async (space) => {
      const pagesResult = await payload.find({
        collection: 'knowledge-pages',
        where: {
          knowledgeSpace: {
            equals: space.id,
          },
        },
        limit: 1000,
      })

      return {
        spaceId: space.id,
        total: pagesResult.docs.length,
        published: pagesResult.docs.filter((p) => p.status === 'published').length,
      }
    })
  )

  const statsMap = spaceStats.reduce(
    (acc, stat) => {
      acc[stat.spaceId] = stat
      return acc
    },
    {} as Record<string, { total: number; published: number }>
  )

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'public':
        return <Globe className="h-4 w-4" />
      case 'internal':
        return <Users className="h-4 w-4" />
      case 'private':
        return <Lock className="h-4 w-4" />
      default:
        return <BookOpen className="h-4 w-4" />
    }
  }

  const getVisibilityColor = (visibility: string) => {
    switch (visibility) {
      case 'public':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'internal':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'private':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
                {/* Header */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                        Knowledge Base
                      </h1>
                      <p className="text-lg text-gray-600 dark:text-gray-400">
                        Documentation and knowledge for {workspace.name}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Empty State */}
                {spaces.length === 0 && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16">
                      <BookOpen className="h-16 w-16 text-gray-400 mb-4" />
                      <h3 className="text-xl font-semibold mb-2">No Knowledge Spaces Yet</h3>
                      <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
                        Knowledge spaces help organize documentation, guides, and other content for
                        your workspace.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Knowledge Spaces Grid */}
                {spaces.length > 0 && (
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {spaces.map((space) => {
                      const stats = statsMap[space.id] || { total: 0, published: 0 }

                      return (
                        <Link
                          key={space.id}
                          href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}
                        >
                          <Card className="h-full transition-all hover:shadow-lg hover:border-primary">
                            <CardHeader>
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {space.icon && <span className="text-2xl">{space.icon}</span>}
                                  <CardTitle className="text-xl">{space.name}</CardTitle>
                                </div>
                                <Badge
                                  variant="secondary"
                                  className={getVisibilityColor(space.visibility)}
                                >
                                  <span className="flex items-center gap-1">
                                    {getVisibilityIcon(space.visibility)}
                                    {space.visibility}
                                  </span>
                                </Badge>
                              </div>
                              {space.description && (
                                <CardDescription className="line-clamp-2">
                                  {space.description}
                                </CardDescription>
                              )}
                            </CardHeader>
                            <CardContent>
                              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-1">
                                  <FileText className="h-4 w-4" />
                                  <span>
                                    {stats.total} {stats.total === 1 ? 'page' : 'pages'}
                                  </span>
                                </div>
                                {stats.published > 0 && (
                                  <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                    <span className="font-semibold">{stats.published}</span>
                                    <span>published</span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
      </SidebarProvider>
  )
}
