import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { PendingApprovalsClient } from './pending-approvals-client'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function WorkspacePendingApprovalsPage({ params }: PageProps) {
  const { slug } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Find the workspace
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
  })

  if (workspaceResult.docs.length === 0) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Check if user is workspace admin
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspace.id } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    // Not a workspace admin, redirect to applications page
    redirect(`/workspaces/${slug}/kafka/applications`)
  }

  return (
    <div className="container mx-auto py-6">
      <PendingApprovalsClient workspaceId={workspace.id} workspaceSlug={slug} />
    </div>
  )
}
