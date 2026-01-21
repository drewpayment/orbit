import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { ClusterDetailClient } from './cluster-detail-client'
import type { KafkaApplication, Workspace } from '@/payload-types'

interface PageProps {
  params: Promise<{
    slug: string
    clusterId: string
  }>
}

export default async function ClusterDetailPage({ params }: PageProps) {
  const { slug: workspaceSlug, clusterId } = await params

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

  // Phase 3: Fetch membership and virtual cluster in parallel
  const [membership, cluster] = await Promise.all([
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
    payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: clusterId,
      depth: 1,
      overrideAccess: true,
    }),
  ])

  if (membership.docs.length === 0) {
    redirect(`/workspaces`)
  }

  const memberRole = membership.docs[0].role

  if (!cluster) {
    notFound()
  }

  // Verify the cluster belongs to this workspace
  // Check through application relationship (old schema) or workspace field (new schema)
  let clusterWorkspaceId: string | undefined

  if ('workspace' in cluster && cluster.workspace) {
    const ws = cluster.workspace as string | Workspace
    clusterWorkspaceId = typeof ws === 'string' ? ws : ws.id
  } else if (cluster.application) {
    const app = cluster.application as string | KafkaApplication
    if (typeof app !== 'string' && app.workspace) {
      const ws = app.workspace as string | Workspace
      clusterWorkspaceId = typeof ws === 'string' ? ws : ws.id
    }
  }

  if (clusterWorkspaceId !== workspace.id) {
    notFound()
  }

  // Get application slug for TopicsPanel (may be empty for workspace-level clusters)
  let applicationSlug = ''
  let applicationId = ''
  if (cluster.application) {
    const app = cluster.application as string | KafkaApplication
    if (typeof app !== 'string') {
      applicationSlug = app.slug || ''
      applicationId = app.id
    }
  }

  // Helper function to derive cluster name
  const getClusterName = (): string => {
    if ('name' in cluster && cluster.name) {
      return cluster.name as string
    }
    return cluster.advertisedHost?.split('.')[0] || 'Unknown'
  }

  return (
    <ClusterDetailClient
      workspaceSlug={workspaceSlug}
      cluster={{
        id: cluster.id,
        name: getClusterName(),
        environment: cluster.environment as 'dev' | 'staging' | 'qa' | 'prod',
        status: cluster.status as 'provisioning' | 'active' | 'read_only' | 'deleting' | 'deleted',
        advertisedHost: cluster.advertisedHost,
        advertisedPort: cluster.advertisedPort,
        topicPrefix: cluster.topicPrefix,
        groupPrefix: cluster.groupPrefix,
      }}
      applicationId={applicationId}
      applicationSlug={applicationSlug}
      canManage={memberRole === 'owner' || memberRole === 'admin' || memberRole === 'member'}
      canApprove={memberRole === 'owner' || memberRole === 'admin'}
      userId={session.user.id}
    />
  )
}
