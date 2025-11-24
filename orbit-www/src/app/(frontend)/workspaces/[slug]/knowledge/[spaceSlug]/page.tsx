import { notFound, redirect } from 'next/navigation'
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

  // If pages exist, redirect to the first page
  if (pages.length > 0) {
    const firstPage = pages[0]
    redirect(`/workspaces/${workspace.slug}/knowledge/${space.slug}/${firstPage.slug}`)
  }

  // Otherwise, show empty state (when no pages exist)
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

            {/* Empty State */}
            <Card>
              <CardHeader>
                <CardTitle>No Pages Yet</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose dark:prose-invert max-w-none">
                  <p className="text-gray-600 dark:text-gray-400">
                    This knowledge space doesn't have any pages yet. Create your first page to get
                    started.
                  </p>
                  {tempUserId && (
                    <div className="mt-6">
                      <SpaceNavigator
                        knowledgeSpace={space}
                        pages={pages}
                        workspaceSlug={workspace.slug}
                        userId={tempUserId}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
