import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, workspaceRole } from '@/lib/authz'
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
  const [payload, actor] = await Promise.all([
    getPayload({ config }),
    getActor(),
  ])

  if (!actor) {
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

  // Phase 3: Fetch membership role and virtual cluster in parallel
  const [memberRole, cluster] = await Promise.all([
    workspaceRole(workspace.id, actor),
    payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: clusterId,
      depth: 1,
      overrideAccess: true,
    }),
  ])

  if (!memberRole) {
    redirect(`/workspaces`)
  }

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
      userId={actor.betterAuthId}
    />
  )
}
