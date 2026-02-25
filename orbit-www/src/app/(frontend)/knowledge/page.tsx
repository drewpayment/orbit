import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { BookOpen, FileText, Globe, Building2 } from 'lucide-react'
import { getPayloadClient } from '@/lib/data/cached-queries'

export default async function KnowledgePage() {
  const payload = await getPayloadClient()

  // Fetch all knowledge spaces the user has access to (access control handles filtering)
  const spacesResult = await payload.find({
    collection: 'knowledge-spaces',
    limit: 100,
    sort: 'name',
    depth: 1, // populate workspace relationship
  })

  const spaces = spacesResult.docs

  // Fetch page counts for each space in parallel
  const spaceStats = await Promise.all(
    spaces.map(async (space) => {
      const pagesResult = await payload.find({
        collection: 'knowledge-pages',
        where: { knowledgeSpace: { equals: space.id } },
        limit: 0,
      })

      return {
        spaceId: space.id,
        total: pagesResult.totalDocs,
      }
    })
  )

  const statsMap = spaceStats.reduce(
    (acc, stat) => {
      acc[stat.spaceId] = stat
      return acc
    },
    {} as Record<string, { total: number }>
  )

  // Group spaces by workspace
  const spacesByWorkspace = spaces.reduce(
    (acc, space) => {
      const ws = typeof space.workspace === 'string'
        ? { id: space.workspace, name: space.workspace, slug: space.workspace }
        : space.workspace
      const key = ws.id
      if (!acc[key]) {
        acc[key] = { workspace: ws, spaces: [] }
      }
      acc[key].spaces.push(space)
      return acc
    },
    {} as Record<string, { workspace: { id: string; name: string; slug: string }; spaces: typeof spaces }>
  )

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

  const getIconEmoji = (icon: string | null | undefined) => {
    if (!icon) return '📚'
    if (icon.length <= 2) return icon
    const iconMap: Record<string, string> = {
      'book': '📖',
      'docs': '📚',
      'guide': '📘',
      'wiki': '📝',
      'notes': '📓',
      'folder': '📁',
      'document': '📄',
    }
    return iconMap[icon.toLowerCase()] || '📚'
  }

  const workspaceGroups = Object.values(spacesByWorkspace)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                Documentation
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                Browse knowledge bases across your workspaces
              </p>
            </div>

            {/* Empty State */}
            {spaces.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <BookOpen className="h-16 w-16 text-gray-400 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No Knowledge Spaces Yet</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-center max-w-md">
                    Knowledge spaces help organize documentation, guides, and other content.
                    Create one from within a workspace to get started.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Knowledge Spaces grouped by Workspace */}
            {workspaceGroups.map(({ workspace: ws, spaces: wsSpaces }) => (
              <div key={ws.id} className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="h-5 w-5 text-gray-500" />
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
                    {ws.name}
                  </h2>
                </div>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {wsSpaces.map((space) => {
                    const stats = statsMap[space.id] || { total: 0 }

                    return (
                      <Link
                        key={space.id}
                        href={`/workspaces/${ws.slug}/knowledge/${space.slug}`}
                      >
                        <Card className="h-full transition-all hover:shadow-lg hover:border-primary">
                          <CardHeader>
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-2xl">{getIconEmoji(space.icon)}</span>
                                <CardTitle className="text-xl">{space.name}</CardTitle>
                              </div>
                              <Badge
                                variant="secondary"
                                className={getVisibilityColor(space.visibility)}
                              >
                                <span className="flex items-center gap-1">
                                  <Globe className="h-3 w-3" />
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
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
