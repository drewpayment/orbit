import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { SharedTopicsList } from '@/components/features/kafka/SharedTopicsList'

interface IncomingPageProps {
  params: Promise<{ slug: string }>
}

export default async function IncomingSharesPage({ params }: IncomingPageProps) {
  const { slug } = await params
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
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

  const userRole = membership.docs[0].role as string
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
