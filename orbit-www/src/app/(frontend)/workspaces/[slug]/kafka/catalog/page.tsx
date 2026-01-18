import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { TopicCatalog } from '@/components/features/kafka/TopicCatalog'
import {
  getSession,
  getWorkspaceBySlug,
  getWorkspaceMembership,
} from '@/lib/data/cached-queries'

interface CatalogPageProps {
  params: Promise<{ slug: string }>
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { slug } = await params

  // Use cached fetchers for request-level deduplication
  const session = await getSession()
  if (!session?.user) {
    notFound()
  }

  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  // Verify user is member using cached membership query
  const membership = await getWorkspaceMembership(workspace.id, session.user.id, {
    overrideAccess: true,
  })
  if (!membership) {
    notFound()
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Topic Catalog</h1>
        <p className="text-muted-foreground">
          Discover and request access to Kafka topics across the platform
        </p>
      </div>

      <Suspense fallback={<div>Loading catalog...</div>}>
        <TopicCatalog
          currentWorkspaceId={workspace.id}
          currentWorkspaceName={workspace.name}
          currentWorkspaceSlug={workspace.slug}
        />
      </Suspense>
    </>
  )
}
