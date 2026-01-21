'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTemporalClient } from '@/lib/temporal/client'
import type { KafkaVirtualCluster, KafkaApplication, Workspace } from '@/payload-types'

// Environment type matching the collection options
// Note: Task 6 will expand this to include 'staging' and 'qa'
type VirtualClusterEnvironment = 'dev' | 'stage' | 'prod'

export interface VirtualClusterData {
  id: string
  name: string
  environment: string
  status: 'provisioning' | 'active' | 'read_only' | 'deleting' | 'deleted'
  advertisedHost: string
  advertisedPort: number
  topicPrefix: string
  groupPrefix: string
  topicCount?: number
  createdAt: string
}

/**
 * Helper to extract the name from a virtual cluster.
 * Once Task 6 adds the `name` field, this will use that directly.
 * For now, we derive it from the advertisedHost.
 */
function getClusterName(cluster: KafkaVirtualCluster): string {
  // New schema: use name field directly (added in Task 6)
  if ('name' in cluster && cluster.name) {
    return cluster.name as string
  }
  // Fallback: derive from advertisedHost (e.g., "payments-dev.dev.kafka.orbit.io" -> "payments-dev")
  return cluster.advertisedHost?.split('.')[0] || 'Unknown'
}

/**
 * Helper to extract workspace ID from a virtual cluster.
 * Once Task 6 adds the `workspace` field, this will use that directly.
 * For now, we go through the application relationship.
 */
function getClusterWorkspaceId(cluster: KafkaVirtualCluster): string | undefined {
  // New schema: use workspace field directly (added in Task 6)
  if ('workspace' in cluster && cluster.workspace) {
    const ws = cluster.workspace as string | Workspace
    return typeof ws === 'string' ? ws : ws.id
  }
  // Fallback: get from application
  if (cluster.application) {
    const app = cluster.application as string | KafkaApplication
    if (typeof app !== 'string' && app.workspace) {
      const ws = app.workspace as string | Workspace
      return typeof ws === 'string' ? ws : ws.id
    }
  }
  return undefined
}

export interface ListVirtualClustersInput {
  workspaceId: string
}

export interface ListVirtualClustersResult {
  success: boolean
  clusters?: VirtualClusterData[]
  error?: string
}

export async function listVirtualClusters(
  input: ListVirtualClustersInput
): Promise<ListVirtualClustersResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Fetch virtual clusters for this workspace
    // Once Task 6 adds the workspace field, we can query directly by workspace.
    // For now, we need to go through the application relationship.
    const applications = await payload.find({
      collection: 'kafka-applications',
      where: {
        workspace: { equals: input.workspaceId },
        status: { not_equals: 'deleted' },
      },
      limit: 1000,
      overrideAccess: true,
    })

    const applicationIds = applications.docs.map((app) => app.id)

    // If no applications, return empty list
    if (applicationIds.length === 0) {
      return { success: true, clusters: [] }
    }

    const clusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { in: applicationIds },
        status: { not_equals: 'deleted' },
      },
      sort: '-createdAt',
      limit: 100,
      overrideAccess: true,
    })

    // Get topic counts for each cluster
    const clusterIds = clusters.docs.map((c) => c.id)
    const topics = await payload.find({
      collection: 'kafka-topics',
      where: {
        virtualCluster: { in: clusterIds },
      },
      limit: 1000,
      overrideAccess: true,
    })

    // Group topic counts by cluster
    const topicCountByCluster = new Map<string, number>()
    for (const topic of topics.docs) {
      const clusterId =
        typeof topic.virtualCluster === 'string' ? topic.virtualCluster : topic.virtualCluster?.id
      if (clusterId) {
        topicCountByCluster.set(clusterId, (topicCountByCluster.get(clusterId) || 0) + 1)
      }
    }

    const result: VirtualClusterData[] = clusters.docs.map((cluster) => ({
      id: cluster.id,
      name: getClusterName(cluster),
      environment: cluster.environment,
      status: cluster.status as VirtualClusterData['status'],
      advertisedHost: cluster.advertisedHost,
      advertisedPort: cluster.advertisedPort,
      topicPrefix: cluster.topicPrefix,
      groupPrefix: cluster.groupPrefix,
      topicCount: topicCountByCluster.get(cluster.id) || 0,
      createdAt: cluster.createdAt,
    }))

    return { success: true, clusters: result }
  } catch (error) {
    console.error('Error listing virtual clusters:', error)
    return { success: false, error: 'Failed to list virtual clusters' }
  }
}

export interface CreateVirtualClusterInput {
  name: string
  environment: string
  workspaceId: string
}

export interface CreateVirtualClusterResult {
  success: boolean
  clusterId?: string
  error?: string
}

export async function createVirtualCluster(
  input: CreateVirtualClusterInput
): Promise<CreateVirtualClusterResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Get workspace for slug
    const workspace = await payload.findByID({
      collection: 'workspaces',
      id: input.workspaceId,
      overrideAccess: true,
    })

    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    // Check if a cluster with this name already exists in workspace
    // For now, check via advertisedHost pattern since name field isn't added yet
    // The advertisedHost follows pattern: {name}.{environment}.kafka.orbit.io
    const expectedHost = `${input.name}.${input.environment}.kafka.orbit.io`
    const existing = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        and: [
          { advertisedHost: { equals: expectedHost } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return { success: false, error: 'A virtual cluster with this name already exists' }
    }

    // Find the physical cluster via environment mapping
    const mapping = await payload.find({
      collection: 'kafka-environment-mappings',
      where: {
        environment: { equals: input.environment },
        isDefault: { equals: true },
      },
      limit: 1,
      overrideAccess: true,
    })

    if (mapping.docs.length === 0) {
      return {
        success: false,
        error: `No default cluster configured for ${input.environment} environment`,
      }
    }

    const physicalClusterId =
      typeof mapping.docs[0].cluster === 'string'
        ? mapping.docs[0].cluster
        : mapping.docs[0].cluster?.id

    if (!physicalClusterId) {
      return { success: false, error: 'Physical cluster not found in mapping' }
    }

    // Generate prefixes
    const prefix = `${workspace.slug}-${input.name}-`
    const advertisedHost = `${input.name}.${input.environment}.kafka.orbit.io`

    // Map environment to the collection's current options
    // The collection currently supports: dev, stage, prod
    // Task 6 will expand to include: staging, qa
    const envMapping: Record<string, VirtualClusterEnvironment> = {
      dev: 'dev',
      development: 'dev',
      stage: 'stage',
      staging: 'stage',
      qa: 'dev', // Map QA to dev for now until Task 6 adds it
      prod: 'prod',
      production: 'prod',
    }
    const mappedEnv = envMapping[input.environment.toLowerCase()] || 'dev'

    // Create the virtual cluster
    // Note: This creates a minimal cluster. Task 6 will add name and workspace fields.
    // For now, we need to create an application first to link the virtual cluster.
    // This is a temporary approach until the schema is updated.

    // First, find or create a "default" application for this workspace
    const defaultApp = await payload.find({
      collection: 'kafka-applications',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { slug: { equals: `${workspace.slug}-default` } },
          { status: { not_equals: 'deleted' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    let applicationId: string

    if (defaultApp.docs.length === 0) {
      // Create a default application for this workspace
      const newApp = await payload.create({
        collection: 'kafka-applications',
        data: {
          name: `${workspace.name} Default`,
          slug: `${workspace.slug}-default`,
          description: 'Default application for workspace virtual clusters',
          workspace: input.workspaceId,
          status: 'active',
          provisioningStatus: 'completed',
        },
        overrideAccess: true,
      })
      applicationId = newApp.id
    } else {
      applicationId = defaultApp.docs[0].id
    }

    const cluster = await payload.create({
      collection: 'kafka-virtual-clusters',
      data: {
        application: applicationId,
        environment: mappedEnv,
        physicalCluster: physicalClusterId,
        topicPrefix: prefix,
        groupPrefix: prefix,
        advertisedHost,
        advertisedPort: 9092,
        status: 'provisioning',
      },
      overrideAccess: true,
    })

    // Trigger Temporal workflow to provision the cluster in Bifrost
    await triggerVirtualClusterProvisionWorkflow({
      clusterId: cluster.id,
      clusterName: input.name,
      workspaceId: input.workspaceId,
      workspaceSlug: workspace.slug,
      environment: input.environment,
    })

    return { success: true, clusterId: cluster.id }
  } catch (error) {
    console.error('Error creating virtual cluster:', error)
    return { success: false, error: 'Failed to create virtual cluster' }
  }
}

export interface GetVirtualClusterInput {
  clusterId: string
}

export interface GetVirtualClusterResult {
  success: boolean
  cluster?: VirtualClusterData & {
    workspaceId: string
    workspaceSlug: string
  }
  error?: string
}

export async function getVirtualCluster(
  input: GetVirtualClusterInput
): Promise<GetVirtualClusterResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const cluster = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: input.clusterId,
      depth: 1,
    })

    if (!cluster) {
      return { success: false, error: 'Virtual cluster not found' }
    }

    // Get workspace info (new schema: direct relationship, old schema: through application)
    let workspaceId: string | undefined
    let workspaceSlug: string = ''

    // Try new schema first (Task 6 adds workspace field)
    if ('workspace' in cluster && cluster.workspace) {
      const ws = cluster.workspace as string | Workspace
      if (typeof ws === 'string') {
        workspaceId = ws
        // Need to fetch workspace to get slug
        const wsDoc = await payload.findByID({
          collection: 'workspaces',
          id: ws,
          overrideAccess: true,
        })
        workspaceSlug = wsDoc?.slug || ''
      } else {
        workspaceId = ws.id
        workspaceSlug = ws.slug || ''
      }
    } else if (cluster.application) {
      // Old schema: go through application
      const app = cluster.application as string | KafkaApplication
      if (typeof app !== 'string' && app.workspace) {
        const ws = app.workspace as string | Workspace
        if (typeof ws === 'string') {
          workspaceId = ws
          const wsDoc = await payload.findByID({
            collection: 'workspaces',
            id: ws,
            overrideAccess: true,
          })
          workspaceSlug = wsDoc?.slug || ''
        } else {
          workspaceId = ws.id
          workspaceSlug = ws.slug || ''
        }
      }
    }

    // Get topic count
    const topics = await payload.find({
      collection: 'kafka-topics',
      where: {
        virtualCluster: { equals: cluster.id },
      },
      limit: 0,
      overrideAccess: true,
    })

    return {
      success: true,
      cluster: {
        id: cluster.id,
        name: getClusterName(cluster),
        environment: cluster.environment,
        status: cluster.status as VirtualClusterData['status'],
        advertisedHost: cluster.advertisedHost,
        advertisedPort: cluster.advertisedPort,
        topicPrefix: cluster.topicPrefix,
        groupPrefix: cluster.groupPrefix,
        topicCount: topics.totalDocs,
        createdAt: cluster.createdAt,
        workspaceId: workspaceId || '',
        workspaceSlug,
      },
    }
  } catch (error) {
    console.error('Error getting virtual cluster:', error)
    return { success: false, error: 'Failed to get virtual cluster' }
  }
}

/**
 * Triggers a workflow to provision the virtual cluster in Bifrost
 */
async function triggerVirtualClusterProvisionWorkflow(input: {
  clusterId: string
  clusterName: string
  workspaceId: string
  workspaceSlug: string
  environment: string
}): Promise<string | null> {
  const workflowId = `virtual-cluster-provision-${input.clusterId}`

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('SingleVirtualClusterProvisionWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [
        {
          ClusterID: input.clusterId,
          ClusterName: input.clusterName,
          WorkspaceID: input.workspaceId,
          WorkspaceSlug: input.workspaceSlug,
          Environment: input.environment,
        },
      ],
    })

    console.log(
      `[Kafka] Started SingleVirtualClusterProvisionWorkflow: ${handle.workflowId} for cluster ${input.clusterName}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start SingleVirtualClusterProvisionWorkflow:', error)
    return null
  }
}
