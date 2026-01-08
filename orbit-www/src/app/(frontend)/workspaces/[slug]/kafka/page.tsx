import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { KafkaTopicsClient } from './kafka-topics-client'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function KafkaPage({ params }: PageProps) {
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

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Kafka Topics
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Manage Kafka topics for {workspace.name}
            </p>
          </div>
        </div>
      </div>

      {/* Topics Client Component */}
      <KafkaTopicsClient
        workspaceId={workspace.id as string}
        workspaceSlug={slug}
      />
    </>
  )
}
