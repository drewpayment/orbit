import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, workspaceRole } from '@/lib/authz'
import { SharedTopicsList } from '@/components/features/kafka/SharedTopicsList'

interface IncomingPageProps {
  params: Promise<{ slug: string }>
}

export default async function IncomingSharesPage({ params }: IncomingPageProps) {
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

  const userRole = await workspaceRole(workspace.id, actor)

  if (!userRole) {
    notFound()
  }

  const canManage = ['owner', 'admin'].includes(userRole)

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Incoming Share Requests</h1>
        <p className="text-muted-foreground">
          Manage access requests from other workspaces to your topics
        </p>
      </div>

      <SharedTopicsList
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        type="incoming"
        canManage={canManage}
      />
    </>
  )
}
