import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { VirtualClustersList } from '@/components/features/kafka'

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
    <VirtualClustersList
      workspaceId={workspace.id as string}
      workspaceSlug={slug}
    />
  )
}
