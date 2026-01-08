import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { TopicDetailClient } from './topic-detail-client'

interface PageProps {
  params: Promise<{
    slug: string
    topicId: string
  }>
}

export default async function TopicDetailPage({ params }: PageProps) {
  const { slug, topicId } = await params
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

  return (
    <TopicDetailClient
      workspaceId={workspace.id as string}
      workspaceSlug={slug}
      topicId={topicId}
    />
  )
}
