import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, check } from '@/lib/authz'
import { SharedTopicsList } from '@/components/features/kafka/SharedTopicsList'

interface OutgoingPageProps {
  params: Promise<{ slug: string }>
}

export default async function OutgoingSharesPage({ params }: OutgoingPageProps) {
  const { slug } = await params
  const actor = await getActor()

  if (!actor) {
    notFound()
  }

  const payload = await getPayload({ config })

  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaces.docs.length === 0) {
    notFound()
  }

  const workspace = workspaces.docs[0]

  const membershipDecision = await check('read', { kind: 'workspace', id: workspace.id }, actor)

  if (!membershipDecision.allowed) {
    notFound()
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Access Requests</h1>
        <p className="text-muted-foreground">
          Track your requests for access to topics from other workspaces
        </p>
      </div>

      <SharedTopicsList
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        type="outgoing"
        canManage={false}
      />
    </>
  )
}
