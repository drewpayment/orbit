import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { ApplicationDetailClient } from './application-detail-client'

interface PageProps {
  params: Promise<{
    slug: string
    appSlug: string
  }>
}

export default async function ApplicationDetailPage({ params }: PageProps) {
  const { slug: workspaceSlug, appSlug } = await params

  // Phase 1: Parallelize initial setup
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user) {
    redirect('/sign-in')
  }

  // Phase 2: Get workspace first (needed for subsequent queries)
  const workspaces = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: workspaceSlug } },
    limit: 1,
  })

  const workspace = workspaces.docs[0]
  if (!workspace) {
    notFound()
  }

  // Phase 3: Fetch membership and application in parallel (both depend on workspace.id)
  const [membership, applications] = await Promise.all([
    payload.find({
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
    }),
    payload.find({
      collection: 'kafka-applications',
      where: {
        and: [{ workspace: { equals: workspace.id } }, { slug: { equals: appSlug } }],
      },
      limit: 1,
      overrideAccess: true,
    }),
  ])

  if (membership.docs.length === 0) {
    redirect(`/workspaces`)
  }

  const memberRole = membership.docs[0].role

  const application = applications.docs[0]
  if (!application) {
    notFound()
  }

  // Phase 4: Get virtual clusters (depends on application.id)
  const virtualClusters = await payload.find({
    collection: 'kafka-virtual-clusters',
    where: {
      application: { equals: application.id },
    },
    sort: 'environment',
    limit: 10,
    overrideAccess: true,
  })

  return (
    <ApplicationDetailClient
      workspaceSlug={workspaceSlug}
      application={{
        id: application.id,
        name: application.name,
        slug: application.slug,
        description: application.description || undefined,
        status: application.status as 'active' | 'decommissioning' | 'deleted',
      }}
      virtualClusters={virtualClusters.docs.map((vc) => ({
        id: vc.id,
        environment: vc.environment as 'dev' | 'stage' | 'prod',
        status: vc.status,
        advertisedHost: vc.advertisedHost,
        topicPrefix: vc.topicPrefix,
      }))}
      canManage={memberRole === 'owner' || memberRole === 'admin' || memberRole === 'member'}
      canApprove={memberRole === 'owner' || memberRole === 'admin'}
      userId={session.user.id}
    />
  )
}
