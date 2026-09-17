import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { TopicCatalog } from '@/components/features/kafka/TopicCatalog'
import {
  getActor,
  getWorkspaceBySlug,
} from '@/lib/data/cached-queries'
import { workspaceRole } from '@/lib/authz'

interface CatalogPageProps {
  params: Promise<{ slug: string }>
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { slug } = await params

  // Use cached fetchers for request-level deduplication
  const actor = await getActor()
  if (!actor) {
    notFound()
  }

  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) {
    notFound()
  }

  // Members only (membership, no platform-admin bypass — preserved).
  if (!(await workspaceRole(workspace.id, actor))) {
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
