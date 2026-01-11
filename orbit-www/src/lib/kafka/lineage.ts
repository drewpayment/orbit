/**
 * Kafka Lineage Edge Management
 *
 * Provides functions for upserting and managing lineage edges
 * that track data flow between applications and topics.
 */

import type { Payload, Where } from 'payload'
import type { KafkaLineageEdge } from '@/payload-types'

/**
 * Input for upserting a lineage edge
 */
export interface LineageEdgeInput {
  /** Application producing/consuming (optional - may be unknown) */
  sourceApplicationId?: string
  /** Service account performing the activity */
  sourceServiceAccountId: string
  /** Workspace of the source application */
  sourceWorkspaceId?: string
  /** Topic being accessed */
  topicId: string
  /** Application that owns the topic (optional) */
  targetApplicationId?: string
  /** Workspace that owns the topic */
  targetWorkspaceId: string
  /** Direction: 'produce' or 'consume' */
  direction: 'produce' | 'consume'
  /** Bytes transferred in this activity window */
  bytes: number
  /** Messages transferred in this activity window */
  messageCount: number
  /** Timestamp of this activity */
  timestamp: Date
}

/**
 * Result of an upsert operation
 */
export interface UpsertResult {
  /** The edge that was created or updated */
  edge: KafkaLineageEdge
  /** Whether this was a new edge or an update */
  isNew: boolean
}

/**
 * Upsert a lineage edge from activity data.
 *
 * If an edge already exists for the same (serviceAccount, topic, direction),
 * the metrics are accumulated and lastSeen is updated.
 * Otherwise, a new edge is created.
 *
 * @param payload - Payload CMS instance
 * @param input - Lineage edge input data
 * @returns The created or updated edge
 */
export async function upsertLineageEdge(
  payload: Payload,
  input: LineageEdgeInput
): Promise<UpsertResult> {
  // Find existing edge for this unique combination
  const existing = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      and: [
        { sourceServiceAccount: { equals: input.sourceServiceAccountId } },
        { topic: { equals: input.topicId } },
        { direction: { equals: input.direction } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  const isCrossWorkspace =
    input.sourceWorkspaceId != null &&
    input.sourceWorkspaceId !== input.targetWorkspaceId

  if (existing.docs.length > 0) {
    // Update existing edge - accumulate metrics
    const edge = existing.docs[0]

    const updated = await payload.update({
      collection: 'kafka-lineage-edges',
      id: edge.id,
      data: {
        // Accumulate 24h metrics (will be reset by aggregation workflow)
        bytesLast24h: (edge.bytesLast24h || 0) + input.bytes,
        messagesLast24h: (edge.messagesLast24h || 0) + input.messageCount,
        // Accumulate all-time metrics
        bytesAllTime: (edge.bytesAllTime || 0) + input.bytes,
        messagesAllTime: (edge.messagesAllTime || 0) + input.messageCount,
        // Update timestamps
        lastSeen: input.timestamp.toISOString(),
        // Mark as active
        isActive: true,
        // Update source info if provided and not already set
        ...(input.sourceApplicationId && !edge.sourceApplication
          ? { sourceApplication: input.sourceApplicationId }
          : {}),
        ...(input.sourceWorkspaceId && !edge.sourceWorkspace
          ? { sourceWorkspace: input.sourceWorkspaceId }
          : {}),
      },
      overrideAccess: true,
    })

    return { edge: updated, isNew: false }
  }

  // Create new edge
  const newEdge = await payload.create({
    collection: 'kafka-lineage-edges',
    data: {
      sourceApplication: input.sourceApplicationId || undefined,
      sourceServiceAccount: input.sourceServiceAccountId,
      sourceWorkspace: input.sourceWorkspaceId || undefined,
      topic: input.topicId,
      targetApplication: input.targetApplicationId || undefined,
      targetWorkspace: input.targetWorkspaceId,
      direction: input.direction,
      bytesLast24h: input.bytes,
      messagesLast24h: input.messageCount,
      bytesAllTime: input.bytes,
      messagesAllTime: input.messageCount,
      firstSeen: input.timestamp.toISOString(),
      lastSeen: input.timestamp.toISOString(),
      isActive: true,
      isCrossWorkspace,
    },
    overrideAccess: true,
  })

  return { edge: newEdge, isNew: true }
}

/**
 * Batch upsert multiple lineage edges.
 *
 * @param payload - Payload CMS instance
 * @param inputs - Array of lineage edge inputs
 * @returns Array of upsert results
 */
export async function batchUpsertLineageEdges(
  payload: Payload,
  inputs: LineageEdgeInput[]
): Promise<UpsertResult[]> {
  // Process sequentially to avoid race conditions on the same edge
  const results: UpsertResult[] = []

  for (const input of inputs) {
    try {
      const result = await upsertLineageEdge(payload, input)
      results.push(result)
    } catch (error) {
      console.error('Failed to upsert lineage edge:', error, input)
      // Continue processing other edges
    }
  }

  return results
}

/**
 * Mark edges as inactive if not seen within the specified hours.
 *
 * @param payload - Payload CMS instance
 * @param hoursThreshold - Mark inactive if lastSeen is older than this (default: 24)
 * @returns Number of edges marked inactive
 */
export async function markInactiveEdges(
  payload: Payload,
  hoursThreshold: number = 24
): Promise<number> {
  const threshold = new Date()
  threshold.setHours(threshold.getHours() - hoursThreshold)

  // Find active edges that haven't been seen recently
  const staleEdges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      and: [
        { isActive: { equals: true } },
        { lastSeen: { less_than: threshold.toISOString() } },
      ],
    },
    limit: 1000,
    overrideAccess: true,
  })

  let count = 0
  for (const edge of staleEdges.docs) {
    await payload.update({
      collection: 'kafka-lineage-edges',
      id: edge.id,
      data: { isActive: false },
      overrideAccess: true,
    })
    count++
  }

  return count
}

/**
 * Reset 24h metrics for edges.
 * Called by the aggregation workflow before accumulating new data.
 *
 * @param payload - Payload CMS instance
 * @returns Number of edges reset
 */
export async function reset24hMetrics(payload: Payload): Promise<number> {
  // Find all edges with non-zero 24h metrics
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      or: [
        { bytesLast24h: { greater_than: 0 } },
        { messagesLast24h: { greater_than: 0 } },
      ],
    },
    limit: 10000,
    overrideAccess: true,
  })

  let count = 0
  for (const edge of edges.docs) {
    await payload.update({
      collection: 'kafka-lineage-edges',
      id: edge.id,
      data: {
        bytesLast24h: 0,
        messagesLast24h: 0,
      },
      overrideAccess: true,
    })
    count++
  }

  return count
}

/**
 * Resolve a service account to its application and workspace.
 *
 * @param payload - Payload CMS instance
 * @param serviceAccountId - Service account ID
 * @returns Application and workspace IDs, or null if not found
 */
export async function resolveServiceAccountContext(
  payload: Payload,
  serviceAccountId: string
): Promise<{ applicationId: string; workspaceId: string } | null> {
  try {
    const sa = await payload.findByID({
      collection: 'kafka-service-accounts',
      id: serviceAccountId,
      depth: 2, // Need depth 2 to get application.workspace
      overrideAccess: true,
    })

    if (!sa) return null

    const applicationId =
      typeof sa.application === 'string' ? sa.application : sa.application?.id

    if (!applicationId) return null

    // Get workspace from application (service accounts belong to applications, not workspaces directly)
    const application =
      typeof sa.application === 'string'
        ? await payload.findByID({
            collection: 'kafka-applications',
            id: sa.application,
            overrideAccess: true,
          })
        : sa.application

    if (!application) return null

    const workspaceId =
      typeof application.workspace === 'string'
        ? application.workspace
        : application.workspace?.id

    if (!workspaceId) return null

    return { applicationId, workspaceId }
  } catch {
    return null
  }
}

/**
 * Resolve a topic to its application and workspace.
 *
 * @param payload - Payload CMS instance
 * @param topicId - Topic ID
 * @returns Application and workspace IDs
 */
export async function resolveTopicContext(
  payload: Payload,
  topicId: string
): Promise<{ applicationId?: string; workspaceId: string } | null> {
  try {
    const topic = await payload.findByID({
      collection: 'kafka-topics',
      id: topicId,
      depth: 1,
      overrideAccess: true,
    })

    if (!topic) return null

    const applicationId =
      typeof topic.application === 'string'
        ? topic.application
        : topic.application?.id
    const workspaceId =
      typeof topic.workspace === 'string' ? topic.workspace : topic.workspace?.id

    if (!workspaceId) return null

    return { applicationId, workspaceId }
  } catch {
    return null
  }
}

// =============================================================================
// Lineage Query Functions
// =============================================================================

/**
 * A lineage node representing an application or service account in the graph
 */
export interface LineageNode {
  id: string
  type: 'application' | 'service-account' | 'topic'
  name: string
  workspaceId?: string
  workspaceName?: string
  /** For topics only */
  environment?: string
}

/**
 * A lineage edge in the graph representation
 */
export interface LineageEdgeGraph {
  id: string
  source: string
  target: string
  direction: 'produce' | 'consume'
  bytesLast24h: number
  messagesLast24h: number
  bytesAllTime: number
  messagesAllTime: number
  isActive: boolean
  isCrossWorkspace: boolean
  lastSeen: string
}

/**
 * Complete lineage graph for a topic or application
 */
export interface LineageGraph {
  nodes: LineageNode[]
  edges: LineageEdgeGraph[]
  centerNode: string
}

/**
 * Get lineage graph centered on a topic.
 * Shows all producers and consumers of the topic.
 *
 * @param payload - Payload CMS instance
 * @param topicId - The topic to get lineage for
 * @param options - Query options
 * @returns Lineage graph with nodes and edges
 */
export async function getTopicLineageGraph(
  payload: Payload,
  topicId: string,
  options: {
    includeInactive?: boolean
    limit?: number
  } = {}
): Promise<LineageGraph> {
  const { includeInactive = false, limit = 100 } = options

  // Get the topic details
  const topic = await payload.findByID({
    collection: 'kafka-topics',
    id: topicId,
    depth: 1,
    overrideAccess: true,
  })

  if (!topic) {
    throw new Error(`Topic not found: ${topicId}`)
  }

  // Build where clause for edges
  const conditions: Where[] = [{ topic: { equals: topicId } }]
  if (!includeInactive) {
    conditions.push({ isActive: { equals: true } })
  }

  // Get all edges for this topic
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: { and: conditions },
    limit,
    depth: 2, // Get related entities
    overrideAccess: true,
  })

  const nodes: Map<string, LineageNode> = new Map()
  const graphEdges: LineageEdgeGraph[] = []

  // Add topic as center node
  const workspaceName =
    typeof topic.workspace === 'object' ? topic.workspace?.name : undefined
  nodes.set(topicId, {
    id: topicId,
    type: 'topic',
    name: topic.name,
    workspaceId:
      typeof topic.workspace === 'string' ? topic.workspace : topic.workspace?.id,
    workspaceName,
    environment: topic.environment || undefined,
  })

  // Process edges
  for (const edge of edges.docs) {
    // Add source node (application or service account)
    const sourceApp =
      typeof edge.sourceApplication === 'object' ? edge.sourceApplication : null
    const sourceSA =
      typeof edge.sourceServiceAccount === 'object'
        ? edge.sourceServiceAccount
        : null
    const sourceWorkspace =
      typeof edge.sourceWorkspace === 'object' ? edge.sourceWorkspace : null

    const sourceIdRaw = sourceApp?.id || sourceSA?.id || edge.sourceServiceAccount
    const sourceId = typeof sourceIdRaw === 'string' ? sourceIdRaw : sourceIdRaw?.id || ''
    if (sourceId && !nodes.has(sourceId)) {
      nodes.set(sourceId, {
        id: sourceId,
        type: sourceApp ? 'application' : 'service-account',
        name: sourceApp?.name || sourceSA?.name || 'Unknown',
        workspaceId: sourceWorkspace?.id,
        workspaceName: sourceWorkspace?.name,
      })
    }

    // Add edge to graph
    graphEdges.push({
      id: edge.id,
      source: sourceId,
      target: topicId,
      direction: edge.direction as 'produce' | 'consume',
      bytesLast24h: edge.bytesLast24h || 0,
      messagesLast24h: edge.messagesLast24h || 0,
      bytesAllTime: edge.bytesAllTime || 0,
      messagesAllTime: edge.messagesAllTime || 0,
      isActive: edge.isActive ?? true,
      isCrossWorkspace: edge.isCrossWorkspace ?? false,
      lastSeen: edge.lastSeen || '',
    })
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: graphEdges,
    centerNode: topicId,
  }
}

/**
 * Get lineage graph centered on an application.
 * Shows all topics the application produces to or consumes from.
 *
 * @param payload - Payload CMS instance
 * @param applicationId - The application to get lineage for
 * @param options - Query options
 * @returns Lineage graph with nodes and edges
 */
export async function getApplicationLineageGraph(
  payload: Payload,
  applicationId: string,
  options: {
    includeInactive?: boolean
    limit?: number
  } = {}
): Promise<LineageGraph> {
  const { includeInactive = false, limit = 100 } = options

  // Get the application details
  const application = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
    depth: 1,
    overrideAccess: true,
  })

  if (!application) {
    throw new Error(`Application not found: ${applicationId}`)
  }

  // Build where clause for edges
  const appConditions: Where[] = [{ sourceApplication: { equals: applicationId } }]
  if (!includeInactive) {
    appConditions.push({ isActive: { equals: true } })
  }

  // Get all edges for this application
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: { and: appConditions },
    limit,
    depth: 2,
    overrideAccess: true,
  })

  const nodes: Map<string, LineageNode> = new Map()
  const graphEdges: LineageEdgeGraph[] = []

  // Add application as center node
  const workspaceName =
    typeof application.workspace === 'object'
      ? application.workspace?.name
      : undefined
  nodes.set(applicationId, {
    id: applicationId,
    type: 'application',
    name: application.name,
    workspaceId:
      typeof application.workspace === 'string'
        ? application.workspace
        : application.workspace?.id,
    workspaceName,
  })

  // Process edges
  for (const edge of edges.docs) {
    // Add topic node
    const topic = typeof edge.topic === 'object' ? edge.topic : null
    const targetWorkspace =
      typeof edge.targetWorkspace === 'object' ? edge.targetWorkspace : null

    const topicId = topic?.id || (typeof edge.topic === 'string' ? edge.topic : '')
    if (topicId && !nodes.has(topicId)) {
      nodes.set(topicId, {
        id: topicId,
        type: 'topic',
        name: topic?.name || 'Unknown Topic',
        workspaceId: targetWorkspace?.id,
        workspaceName: targetWorkspace?.name,
        environment: topic?.environment || undefined,
      })
    }

    // Add edge to graph
    graphEdges.push({
      id: edge.id,
      source: applicationId,
      target: topicId,
      direction: edge.direction as 'produce' | 'consume',
      bytesLast24h: edge.bytesLast24h || 0,
      messagesLast24h: edge.messagesLast24h || 0,
      bytesAllTime: edge.bytesAllTime || 0,
      messagesAllTime: edge.messagesAllTime || 0,
      isActive: edge.isActive ?? true,
      isCrossWorkspace: edge.isCrossWorkspace ?? false,
      lastSeen: edge.lastSeen || '',
    })
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: graphEdges,
    centerNode: applicationId,
  }
}

/**
 * Summary of lineage for a topic
 */
export interface TopicLineageSummary {
  topicId: string
  topicName: string
  producerCount: number
  consumerCount: number
  crossWorkspaceProducers: number
  crossWorkspaceConsumers: number
  totalBytesLast24h: number
  totalMessagesLast24h: number
  producers: Array<{
    id: string
    name: string
    type: 'application' | 'service-account'
    bytesLast24h: number
    messagesLast24h: number
    lastSeen: string
    isCrossWorkspace: boolean
  }>
  consumers: Array<{
    id: string
    name: string
    type: 'application' | 'service-account'
    bytesLast24h: number
    messagesLast24h: number
    lastSeen: string
    isCrossWorkspace: boolean
  }>
}

/**
 * Get a summary of lineage for a topic.
 *
 * @param payload - Payload CMS instance
 * @param topicId - The topic to get lineage summary for
 * @returns Lineage summary with producer/consumer counts and details
 */
export async function getTopicLineageSummary(
  payload: Payload,
  topicId: string
): Promise<TopicLineageSummary> {
  const topic = await payload.findByID({
    collection: 'kafka-topics',
    id: topicId,
    overrideAccess: true,
  })

  if (!topic) {
    throw new Error(`Topic not found: ${topicId}`)
  }

  // Get active edges for this topic
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      and: [{ topic: { equals: topicId } }, { isActive: { equals: true } }],
    },
    limit: 100,
    depth: 2,
    overrideAccess: true,
  })

  const producers: TopicLineageSummary['producers'] = []
  const consumers: TopicLineageSummary['consumers'] = []
  let totalBytesLast24h = 0
  let totalMessagesLast24h = 0
  let crossWorkspaceProducers = 0
  let crossWorkspaceConsumers = 0

  for (const edge of edges.docs) {
    const sourceApp =
      typeof edge.sourceApplication === 'object' ? edge.sourceApplication : null
    const sourceSA =
      typeof edge.sourceServiceAccount === 'object'
        ? edge.sourceServiceAccount
        : null

    const entry = {
      id: sourceApp?.id || sourceSA?.id || '',
      name: sourceApp?.name || sourceSA?.name || 'Unknown',
      type: (sourceApp ? 'application' : 'service-account') as
        | 'application'
        | 'service-account',
      bytesLast24h: edge.bytesLast24h || 0,
      messagesLast24h: edge.messagesLast24h || 0,
      lastSeen: edge.lastSeen || '',
      isCrossWorkspace: edge.isCrossWorkspace ?? false,
    }

    totalBytesLast24h += edge.bytesLast24h || 0
    totalMessagesLast24h += edge.messagesLast24h || 0

    if (edge.direction === 'produce') {
      producers.push(entry)
      if (edge.isCrossWorkspace) crossWorkspaceProducers++
    } else {
      consumers.push(entry)
      if (edge.isCrossWorkspace) crossWorkspaceConsumers++
    }
  }

  return {
    topicId,
    topicName: topic.name,
    producerCount: producers.length,
    consumerCount: consumers.length,
    crossWorkspaceProducers,
    crossWorkspaceConsumers,
    totalBytesLast24h,
    totalMessagesLast24h,
    producers,
    consumers,
  }
}

/**
 * Summary of lineage for an application
 */
export interface ApplicationLineageSummary {
  applicationId: string
  applicationName: string
  producesToCount: number
  consumesFromCount: number
  crossWorkspaceTopics: number
  totalBytesLast24h: number
  totalMessagesLast24h: number
  producesTo: Array<{
    topicId: string
    topicName: string
    bytesLast24h: number
    messagesLast24h: number
    lastSeen: string
    isCrossWorkspace: boolean
  }>
  consumesFrom: Array<{
    topicId: string
    topicName: string
    bytesLast24h: number
    messagesLast24h: number
    lastSeen: string
    isCrossWorkspace: boolean
  }>
}

/**
 * Get a summary of lineage for an application.
 *
 * @param payload - Payload CMS instance
 * @param applicationId - The application to get lineage summary for
 * @returns Lineage summary with topic counts and details
 */
export async function getApplicationLineageSummary(
  payload: Payload,
  applicationId: string
): Promise<ApplicationLineageSummary> {
  const application = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
    overrideAccess: true,
  })

  if (!application) {
    throw new Error(`Application not found: ${applicationId}`)
  }

  // Get active edges for this application
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      and: [
        { sourceApplication: { equals: applicationId } },
        { isActive: { equals: true } },
      ],
    },
    limit: 100,
    depth: 2,
    overrideAccess: true,
  })

  const producesTo: ApplicationLineageSummary['producesTo'] = []
  const consumesFrom: ApplicationLineageSummary['consumesFrom'] = []
  let totalBytesLast24h = 0
  let totalMessagesLast24h = 0
  let crossWorkspaceTopics = 0

  for (const edge of edges.docs) {
    const topic = typeof edge.topic === 'object' ? edge.topic : null

    const entry = {
      topicId: topic?.id || '',
      topicName: topic?.name || 'Unknown Topic',
      bytesLast24h: edge.bytesLast24h || 0,
      messagesLast24h: edge.messagesLast24h || 0,
      lastSeen: edge.lastSeen || '',
      isCrossWorkspace: edge.isCrossWorkspace ?? false,
    }

    totalBytesLast24h += edge.bytesLast24h || 0
    totalMessagesLast24h += edge.messagesLast24h || 0

    if (edge.isCrossWorkspace) crossWorkspaceTopics++

    if (edge.direction === 'produce') {
      producesTo.push(entry)
    } else {
      consumesFrom.push(entry)
    }
  }

  return {
    applicationId,
    applicationName: application.name,
    producesToCount: producesTo.length,
    consumesFromCount: consumesFrom.length,
    crossWorkspaceTopics,
    totalBytesLast24h,
    totalMessagesLast24h,
    producesTo,
    consumesFrom,
  }
}

/**
 * Get cross-workspace lineage edges for a workspace.
 * Useful for security auditing and data governance.
 *
 * @param payload - Payload CMS instance
 * @param workspaceId - The workspace to check cross-workspace access for
 * @param direction - Filter by direction ('inbound' = other workspaces accessing this workspace's topics,
 *                    'outbound' = this workspace accessing other workspace's topics)
 * @returns Array of cross-workspace edges
 */
export async function getCrossWorkspaceLineage(
  payload: Payload,
  workspaceId: string,
  direction: 'inbound' | 'outbound' | 'both' = 'both'
): Promise<KafkaLineageEdge[]> {
  const results: KafkaLineageEdge[] = []

  if (direction === 'inbound' || direction === 'both') {
    // Other workspaces accessing this workspace's topics
    const inbound = await payload.find({
      collection: 'kafka-lineage-edges',
      where: {
        and: [
          { targetWorkspace: { equals: workspaceId } },
          { isCrossWorkspace: { equals: true } },
          { isActive: { equals: true } },
        ],
      },
      limit: 100,
      depth: 2,
      overrideAccess: true,
    })
    results.push(...inbound.docs)
  }

  if (direction === 'outbound' || direction === 'both') {
    // This workspace accessing other workspace's topics
    const outbound = await payload.find({
      collection: 'kafka-lineage-edges',
      where: {
        and: [
          { sourceWorkspace: { equals: workspaceId } },
          { isCrossWorkspace: { equals: true } },
          { isActive: { equals: true } },
        ],
      },
      limit: 100,
      depth: 2,
      overrideAccess: true,
    })
    results.push(...outbound.docs)
  }

  return results
}
