import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { TopicCatalog } from '@/components/features/kafka/TopicCatalog'

interface CatalogPageProps {
  params: Promise<{ slug: string }>
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { slug } = await params
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    notFound()
  }

  const payload = await getPayload({ config })

  // Get workspace
  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaces.docs.length === 0) {
    notFound()
  }

  const workspace = workspaces.docs[0]

  // Verify user is member
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    notFound()
  }

  return (
    <div className="container py-6">
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
        />
      </Suspense>
    </div>
  )
}
