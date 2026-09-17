import { getPayload } from 'payload'
import config from '@payload-config'
import { redirect, notFound } from 'next/navigation'
import { getActor, check } from '@/lib/authz'
import { PendingApprovalsClient } from './pending-approvals-client'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function WorkspacePendingApprovalsPage({ params }: PageProps) {
  const { slug } = await params

  const actor = await getActor()

  if (!actor) {
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
  const adminDecision = await check('manage', { kind: 'workspace', id: workspace.id }, actor)

  if (!adminDecision.allowed) {
    // Not a workspace admin, redirect to applications page
    redirect(`/workspaces/${slug}/kafka/applications`)
  }

  return (
    <div className="container mx-auto py-6">
      <PendingApprovalsClient workspaceId={workspace.id} workspaceSlug={slug} />
    </div>
  )
}
