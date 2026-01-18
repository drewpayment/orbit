'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTemporalClient } from '@/lib/temporal/client'

// ============================================================================
// Type Definitions
// ============================================================================

export type TopicCatalogEntry = {
  id: string
  name: string
  description?: string | null
  workspace: {
    id: string
    name: string
    slug: string
  }
  application?: {
    id: string
    name: string
  } | null
  environment: string
  visibility: 'private' | 'workspace' | 'discoverable' | 'public'
  tags: string[]
  partitions: number
  hasActiveShare: boolean
  shareStatus?: 'none' | 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired'
  shareId?: string
}

export type SearchTopicCatalogInput = {
  query?: string
  visibility?: ('private' | 'workspace' | 'discoverable' | 'public')[]
  environment?: string
  workspaceId?: string
  tags?: string[]
  page?: number
  limit?: number
}

export type SearchTopicCatalogResult = {
  success: boolean
  topics?: TopicCatalogEntry[]
  totalCount?: number
  page?: number
  totalPages?: number
  error?: string
}

export type RequestTopicAccessInput = {
  topicId: string
  accessLevel: 'read' | 'write' | 'read-write'
  reason: string
  requestingWorkspaceId: string
}

export type RequestTopicAccessResult = {
  success: boolean
  shareId?: string
  error?: string
  autoApproved?: boolean
}

export type ConnectionDetails = {
  bootstrapServers: string
  topicName: string
  authMethod: 'SASL/SCRAM-SHA-256' | 'SASL/SCRAM-SHA-512' | 'SASL/PLAIN'
  tlsEnabled: boolean
  serviceAccounts: Array<{
    id: string
    name: string
    username: string
    status: 'active' | 'revoked'
  }>
  applicationId: string
  applicationSlug: string
  applicationName: string
  shareStatus: string
}

export type GetConnectionDetailsResult = {
  success: boolean
  connectionDetails?: ConnectionDetails
  error?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a topic should be auto-approved based on share policies
 */
async function checkAutoApprove(
  payload: Awaited<ReturnType<typeof getPayload>>,
  _topicId: string, // Reserved for topic-specific policies in the future
  ownerWorkspaceId: string,
  requestingWorkspaceId: string,
  accessLevel: string
): Promise<boolean> {
  // Find applicable share policies
  const policies = await payload.find({
    collection: 'kafka-topic-share-policies',
    where: {
      and: [
        { enabled: { equals: true } },
        {
          or: [
            { workspace: { equals: ownerWorkspaceId } },
            { workspace: { exists: false } },
          ],
        },
      ],
    },
    sort: '-priority',
    limit: 10,
    overrideAccess: true,
  })

  for (const policy of policies.docs) {
    // Check if auto-approve is enabled
    if (!policy.autoApprove) continue

    // Check if access level is allowed
    const allowedLevels = policy.allowedAccessLevels as string[] | undefined
    if (allowedLevels?.length && !allowedLevels.includes(accessLevel)) {
      continue
    }

    // Check if requesting workspace is in auto-approve list
    const autoApproveWorkspaces = policy.autoApproveWorkspaces as (string | { id: string })[] | undefined
    if (autoApproveWorkspaces?.length) {
      const workspaceIds = autoApproveWorkspaces.map(w =>
        typeof w === 'string' ? w : w.id
      )
      if (workspaceIds.includes(requestingWorkspaceId)) {
        return true
      }
    } else {
      // If no specific workspaces listed and autoApprove is true, approve all
      return true
    }
  }

  return false
}

/**
 * Trigger workflow for approved share (auto-approval path)
 */
async function triggerShareApprovedWorkflow(shareId: string, topicId: string): Promise<void> {
  const payload = await getPayload({ config })

  // Fetch full share record to get all needed data
  const share = await payload.findByID({
    collection: 'kafka-topic-shares',
    id: shareId,
    depth: 2,
    overrideAccess: true,
  })

  if (!share) {
    throw new Error(`Share ${shareId} not found`)
  }

  // Get topic physical name
  const topic = typeof share.topic === 'string'
    ? await payload.findByID({ collection: 'kafka-topics', id: share.topic, overrideAccess: true })
    : share.topic

  const topicName = topic?.fullTopicName || topic?.name || ''

  // Get target workspace ID
  const targetWorkspaceId = typeof share.targetWorkspace === 'string'
    ? share.targetWorkspace
    : share.targetWorkspace.id

  const client = await getTemporalClient()
  const workflowId = `access-provision-${shareId}`

  await client.workflow.start('AccessProvisioningWorkflow', {
    taskQueue: 'orbit-workflows',
    workflowId,
    args: [{
      ShareID: shareId,
      TopicID: topicId,
      TopicName: topicName,
      WorkspaceID: targetWorkspaceId,
      Permission: share.accessLevel || 'read',
      ExpiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString() : null,
    }],
  })

  console.log(`[Kafka] Started AccessProvisioningWorkflow (auto-approved): ${workflowId}`)
}

/**
 * Send notification for share request (placeholder for notification system)
 */
async function sendShareRequestNotification(
  ownerWorkspaceId: string,
  requestingWorkspaceId: string,
  topicName: string
): Promise<void> {
  // TODO: Implement notification system integration
  console.log('Sending share request notification:', {
    ownerWorkspaceId,
    requestingWorkspaceId,
    topicName,
  })
}

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Search the topic catalog for discoverable topics
 *
 * Returns topics based on visibility:
 * - 'discoverable' and 'public' topics are visible to all authenticated users
 * - 'workspace' visibility topics are visible to members of the owning workspace
 * - 'private' topics are only visible to the owning application
 */
export async function searchTopicCatalog(
  input: SearchTopicCatalogInput
): Promise<SearchTopicCatalogResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Get user's workspace memberships
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: userId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    const userWorkspaceIds = memberships.docs.map(m =>
      typeof m.workspace === 'string' ? m.workspace : m.workspace.id
    )

    // Build visibility filter
    // By default, show discoverable and public topics
    // Plus workspace-visibility topics from user's workspaces
    const visibilityFilter = input.visibility?.length
      ? input.visibility
      : ['discoverable', 'public']

    const visibilityConditions: any[] = []

    // Always include discoverable and public if requested
    if (visibilityFilter.includes('discoverable') || visibilityFilter.includes('public')) {
      visibilityConditions.push({
        visibility: {
          in: visibilityFilter.filter(v => v === 'discoverable' || v === 'public'),
        },
      })
    }

    // Include workspace-visible topics from user's workspaces
    if (visibilityFilter.includes('workspace') && userWorkspaceIds.length > 0) {
      visibilityConditions.push({
        and: [
          { visibility: { equals: 'workspace' } },
          { workspace: { in: userWorkspaceIds } },
        ],
      })
    }

    // Build main query conditions
    const whereConditions: any[] = [
      { status: { equals: 'active' } },
    ]

    // Add visibility filter
    if (visibilityConditions.length > 0) {
      whereConditions.push({
        or: visibilityConditions,
      })
    } else {
      // If no valid visibility conditions, return empty results
      return {
        success: true,
        topics: [],
        totalCount: 0,
        page: 1,
        totalPages: 0,
      }
    }

    // Add text search if query provided
    if (input.query) {
      whereConditions.push({
        or: [
          { name: { contains: input.query } },
          { description: { contains: input.query } },
        ],
      })
    }

    // Add environment filter
    if (input.environment) {
      whereConditions.push({
        environment: { equals: input.environment },
      })
    }

    // Add workspace filter
    if (input.workspaceId) {
      whereConditions.push({
        workspace: { equals: input.workspaceId },
      })
    }

    // Add tags filter
    if (input.tags?.length) {
      whereConditions.push({
        'tags.tag': { in: input.tags },
      })
    }

    const page = input.page ?? 1
    const limit = input.limit ?? 20

    // Query topics
    const topicsResult = await payload.find({
      collection: 'kafka-topics',
      where: {
        and: whereConditions,
      },
      sort: '-createdAt',
      page,
      limit,
      depth: 2,
      overrideAccess: true,
    })

    // Get topic IDs to check for existing shares
    const topicIds = topicsResult.docs.map(t => t.id)

    // Check existing shares for these topics from user's workspaces
    const existingShares = await payload.find({
      collection: 'kafka-topic-shares',
      where: {
        and: [
          { topic: { in: topicIds } },
          { targetWorkspace: { in: userWorkspaceIds } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    // Build share status map
    const shareStatusMap = new Map<string, { hasActive: boolean; status: string; shareId: string }>()
    for (const share of existingShares.docs) {
      const topicId = typeof share.topic === 'string' ? share.topic : share.topic.id
      const existing = shareStatusMap.get(topicId)

      // Prioritize approved > pending > other statuses
      if (!existing || share.status === 'approved' ||
          (share.status === 'pending' && existing.status !== 'approved')) {
        shareStatusMap.set(topicId, {
          hasActive: share.status === 'approved',
          status: share.status,
          shareId: share.id,
        })
      }
    }

    // Transform to catalog entries
    const topics: TopicCatalogEntry[] = topicsResult.docs.map(topic => {
      const workspace = typeof topic.workspace === 'string'
        ? { id: topic.workspace, name: 'Unknown', slug: 'unknown' }
        : { id: topic.workspace.id, name: topic.workspace.name ?? 'Unknown', slug: topic.workspace.slug ?? 'unknown' }

      const application = topic.application
        ? typeof topic.application === 'string'
          ? { id: topic.application, name: 'Unknown' }
          : { id: topic.application.id, name: topic.application.name ?? 'Unknown' }
        : null

      const tags = Array.isArray(topic.tags)
        ? topic.tags.map(t => typeof t === 'string' ? t : t.tag ?? '').filter(Boolean)
        : []

      const shareInfo = shareStatusMap.get(topic.id)

      return {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        workspace,
        application,
        environment: topic.environment,
        visibility: (topic.visibility ?? 'private') as TopicCatalogEntry['visibility'],
        tags,
        partitions: topic.partitions,
        hasActiveShare: shareInfo?.hasActive ?? false,
        shareStatus: shareInfo?.status as TopicCatalogEntry['shareStatus'] ?? 'none',
        shareId: shareInfo?.shareId,
      }
    })

    return {
      success: true,
      topics,
      totalCount: topicsResult.totalDocs,
      page: topicsResult.page ?? 1,
      totalPages: topicsResult.totalPages ?? 1,
    }
  } catch (error) {
    console.error('Failed to search topic catalog:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Request access to a topic from another workspace
 *
 * Creates a share request that may be auto-approved based on policies
 */
export async function requestTopicAccess(
  input: RequestTopicAccessInput
): Promise<RequestTopicAccessResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Verify user is a member of the requesting workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.requestingWorkspaceId } },
          { user: { equals: userId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of the requesting workspace' }
    }

    // Get the topic to find owner workspace
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: input.topicId,
      depth: 1,
      overrideAccess: true,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    const ownerWorkspaceId = typeof topic.workspace === 'string'
      ? topic.workspace
      : topic.workspace.id

    // Prevent self-sharing
    if (ownerWorkspaceId === input.requestingWorkspaceId) {
      return { success: false, error: 'Cannot request access to a topic owned by your workspace' }
    }

    // Check for existing share requests
    const existingShare = await payload.find({
      collection: 'kafka-topic-shares',
      where: {
        and: [
          { topic: { equals: input.topicId } },
          { targetWorkspace: { equals: input.requestingWorkspaceId } },
          {
            status: {
              in: ['pending', 'approved'],
            },
          },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existingShare.docs.length > 0) {
      const existingStatus = existingShare.docs[0].status
      return {
        success: false,
        error: `A share request already exists with status: ${existingStatus}`,
      }
    }

    // Check if auto-approval applies
    const shouldAutoApprove = await checkAutoApprove(
      payload,
      input.topicId,
      ownerWorkspaceId,
      input.requestingWorkspaceId,
      input.accessLevel
    )

    // Create the share record
    const share = await payload.create({
      collection: 'kafka-topic-shares',
      data: {
        topic: input.topicId,
        ownerWorkspace: ownerWorkspaceId,
        targetWorkspace: input.requestingWorkspaceId,
        accessLevel: input.accessLevel,
        status: shouldAutoApprove ? 'approved' : 'pending',
        reason: input.reason,
        requestedBy: userId,
        ...(shouldAutoApprove && {
          approvedAt: new Date().toISOString(),
          // System auto-approval - no approvedBy user
        }),
      },
      overrideAccess: true,
    })

    // Trigger appropriate follow-up actions
    if (shouldAutoApprove) {
      await triggerShareApprovedWorkflow(share.id, input.topicId)
    } else {
      await sendShareRequestNotification(
        ownerWorkspaceId,
        input.requestingWorkspaceId,
        topic.name
      )
    }

    return {
      success: true,
      shareId: share.id,
      autoApproved: shouldAutoApprove,
    }
  } catch (error) {
    console.error('Failed to request topic access:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get connection details for an approved topic share
 *
 * Returns bootstrap servers, topic name, auth method, and service accounts
 * for connecting to a shared topic.
 */
export async function getConnectionDetails(
  shareId: string
): Promise<GetConnectionDetailsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Fetch the share with related data
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: shareId,
      depth: 2,
      overrideAccess: true,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    // Get workspace IDs
    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id
    const targetWorkspaceId = typeof share.targetWorkspace === 'string'
      ? share.targetWorkspace
      : share.targetWorkspace.id

    // Verify user has access (member of owner or target workspace)
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: userId } },
          { status: { equals: 'active' } },
          {
            or: [
              { workspace: { equals: ownerWorkspaceId } },
              { workspace: { equals: targetWorkspaceId } },
            ],
          },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (memberships.docs.length === 0) {
      return { success: false, error: 'Access denied' }
    }

    // Get topic details
    const topic = typeof share.topic === 'string'
      ? await payload.findByID({ collection: 'kafka-topics', id: share.topic, depth: 2, overrideAccess: true })
      : share.topic

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    // Get Bifrost config
    const { getBifrostConfig } = await import('@/lib/bifrost-config')
    const bifrostConfig = await getBifrostConfig()

    // Get the virtual cluster for this topic
    const virtualCluster = typeof topic.virtualCluster === 'string'
      ? await payload.findByID({ collection: 'kafka-virtual-clusters', id: topic.virtualCluster, overrideAccess: true })
      : topic.virtualCluster

    // Determine bootstrap servers and topic name based on connection mode
    let bootstrapServers: string
    let topicName: string

    if (bifrostConfig.connectionMode === 'bifrost') {
      // In bifrost mode, use the virtual cluster's advertised host
      bootstrapServers = virtualCluster?.advertisedHost || bifrostConfig.advertisedHost
      topicName = topic.name // Short name - Bifrost rewrites
    } else {
      // Direct mode - use physical cluster details
      const cluster = typeof topic.cluster === 'string'
        ? await payload.findByID({ collection: 'kafka-clusters', id: topic.cluster, overrideAccess: true })
        : topic.cluster

      // bootstrapServers is stored in connectionConfig JSON field
      const connectionConfig = cluster?.connectionConfig as { bootstrapServers?: string } | null
      bootstrapServers = connectionConfig?.bootstrapServers || bifrostConfig.advertisedHost
      topicName = topic.fullTopicName || topic.name
    }

    // Find the requesting application to get service accounts
    // First, find applications in the target workspace
    const apps = await payload.find({
      collection: 'kafka-applications',
      where: {
        workspace: { equals: targetWorkspaceId },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Get service accounts for these applications
    const appIds = apps.docs.map(a => a.id)
    const serviceAccountsResult = await payload.find({
      collection: 'kafka-service-accounts',
      where: {
        and: [
          { application: { in: appIds } },
          { status: { equals: 'active' } },
        ],
      },
      depth: 1,
      limit: 100,
      overrideAccess: true,
    })

    const serviceAccounts = serviceAccountsResult.docs.map(sa => {
      return {
        id: sa.id,
        name: sa.name,
        username: sa.username,
        status: sa.status as 'active' | 'revoked',
      }
    })

    // Get first app for display (or use target workspace info)
    const primaryApp = apps.docs[0]

    return {
      success: true,
      connectionDetails: {
        bootstrapServers,
        topicName,
        authMethod: bifrostConfig.defaultAuthMethod,
        tlsEnabled: bifrostConfig.tlsEnabled,
        serviceAccounts,
        applicationId: primaryApp?.id || '',
        applicationSlug: primaryApp?.slug || '',
        applicationName: primaryApp?.name || 'No application',
        shareStatus: share.status,
      },
    }
  } catch (error) {
    console.error('Failed to get connection details:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get connection details for your own topic (not via a share)
 *
 * Use this when viewing connection details for a topic in your own workspace.
 */
export async function getOwnTopicConnectionDetails(
  topicId: string
): Promise<GetConnectionDetailsResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Fetch the topic with related data
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: topicId,
      depth: 2,
      overrideAccess: true,
    })

    if (!topic) {
      return { success: false, error: 'Topic not found' }
    }

    // Get the workspace ID from the topic
    const workspaceId = typeof topic.workspace === 'string'
      ? topic.workspace
      : topic.workspace?.id

    if (!workspaceId) {
      return { success: false, error: 'Topic has no workspace' }
    }

    // Verify user is a member of this workspace
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: userId } },
          { status: { equals: 'active' } },
          { workspace: { equals: workspaceId } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (memberships.docs.length === 0) {
      return { success: false, error: 'Access denied - you must be a workspace member' }
    }

    // Get Bifrost config
    const { getBifrostConfig } = await import('@/lib/bifrost-config')
    const bifrostConfig = await getBifrostConfig()

    // Get the virtual cluster for this topic
    const virtualCluster = typeof topic.virtualCluster === 'string'
      ? await payload.findByID({ collection: 'kafka-virtual-clusters', id: topic.virtualCluster, overrideAccess: true })
      : topic.virtualCluster

    // Determine bootstrap servers and topic name based on connection mode
    let bootstrapServers: string
    let topicName: string

    if (bifrostConfig.connectionMode === 'bifrost') {
      // In bifrost mode, use the virtual cluster's advertised host
      bootstrapServers = virtualCluster?.advertisedHost || bifrostConfig.advertisedHost
      topicName = topic.name // Short name - Bifrost rewrites
    } else {
      // Direct mode - use physical cluster details
      const cluster = typeof topic.cluster === 'string'
        ? await payload.findByID({ collection: 'kafka-clusters', id: topic.cluster, overrideAccess: true })
        : topic.cluster

      // bootstrapServers is stored in connectionConfig JSON field
      const connectionConfig = cluster?.connectionConfig as { bootstrapServers?: string } | null
      bootstrapServers = connectionConfig?.bootstrapServers || bifrostConfig.advertisedHost
      topicName = topic.fullTopicName || topic.name
    }

    // Find applications in this workspace
    const apps = await payload.find({
      collection: 'kafka-applications',
      where: {
        workspace: { equals: workspaceId },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Get service accounts for these applications
    const appIds = apps.docs.map(a => a.id)
    const serviceAccountsResult = appIds.length > 0
      ? await payload.find({
          collection: 'kafka-service-accounts',
          where: {
            and: [
              { application: { in: appIds } },
              { status: { equals: 'active' } },
            ],
          },
          depth: 1,
          limit: 100,
          overrideAccess: true,
        })
      : { docs: [] }

    const serviceAccounts = serviceAccountsResult.docs.map(sa => {
      return {
        id: sa.id,
        name: sa.name,
        username: sa.username,
        status: sa.status as 'active' | 'revoked',
      }
    })

    // Get first app for display
    const primaryApp = apps.docs[0]

    return {
      success: true,
      connectionDetails: {
        bootstrapServers,
        topicName,
        authMethod: bifrostConfig.defaultAuthMethod,
        tlsEnabled: bifrostConfig.tlsEnabled,
        serviceAccounts,
        applicationId: primaryApp?.id || '',
        applicationSlug: primaryApp?.slug || '',
        applicationName: primaryApp?.name || 'No application',
        shareStatus: 'approved', // Own topics are always "approved"
      },
    }
  } catch (error) {
    console.error('Failed to get own topic connection details:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
