import { notFound, redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SpaceNavigator } from '@/components/features/knowledge/SpaceNavigator'
import {
  getWorkspaceBySlug,
  getKnowledgeSpaceBySlug,
  getKnowledgePagesBySpace,
  getPayloadClient,
} from '@/lib/data/cached-queries'

interface PageProps {
  params: Promise<{
    slug: string
    spaceSlug: string
  }>
}

export default async function KnowledgeSpacePage({ params }: PageProps) {
  const { slug, spaceSlug } = await params

  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  const payload = await getPayloadClient()
  const [usersResult, space] = await Promise.all([
    payload.find({
      collection: 'users',
      limit: 1,
    }),
    getKnowledgeSpaceBySlug(spaceSlug, workspace.id),
  ])

  const tempUserId = usersResult.docs[0]?.id

  if (!space) {
    notFound()
  }

  const pages = await getKnowledgePagesBySpace(space.id)

  // If pages exist, redirect to the first page
  if (pages.length > 0) {
    const firstPage = pages[0]
    redirect(`/workspaces/${workspace.slug}/knowledge/${space.slug}/${firstPage.slug}`)
  }

  // Empty state — layout already provides sidebar, header, and tree sidebar
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-12 py-8">
        <Card>
          <CardHeader>
            <CardTitle>No Pages Yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This knowledge space doesn&apos;t have any pages yet. Create your first page to get
              started.
            </p>
            {tempUserId && (
              <SpaceNavigator
                knowledgeSpace={space}
                pages={pages}
                workspaceSlug={workspace.slug}
                userId={tempUserId}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
