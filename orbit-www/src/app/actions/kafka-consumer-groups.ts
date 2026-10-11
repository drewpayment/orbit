'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { bifrostAdminClient } from '@/lib/grpc/bifrost-admin-client'
import {
  ConsumerGroupState,
  OffsetResetType,
} from '@/lib/proto/idp/gateway/v1/gateway_pb'
import type { KafkaVirtualCluster, KafkaCluster, KafkaApplication } from '@/payload-types'
import { getActor, check } from '@/lib/authz'

// ============================================================================
// Types
// ============================================================================

export interface ConsumerGroupSummary {
  groupId: string
  state: string
  memberCount: number
  topics: string[]
  totalLag: number
}

export interface PartitionLag {
  topic: string
  partition: number
  currentOffset: number
  endOffset: number
  lag: number
  consumerId: string
}

export interface ConsumerGroupDetail extends ConsumerGroupSummary {
  partitions: PartitionLag[]
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapGroupState(state: ConsumerGroupState): string {
  switch (state) {
    case ConsumerGroupState.STABLE:
      return 'Stable'
    case ConsumerGroupState.PREPARING_REBALANCE:
      return 'PreparingRebalance'
    case ConsumerGroupState.COMPLETING_REBALANCE:
      return 'CompletingRebalance'
    case ConsumerGroupState.EMPTY:
      return 'Empty'
    case ConsumerGroupState.DEAD:
      return 'Dead'
    default:
      return 'Unknown'
  }
}

function mapResetType(
  type: 'earliest' | 'latest' | 'timestamp'
): OffsetResetType {
  switch (type) {
    case 'earliest':
      return OffsetResetType.EARLIEST
    case 'latest':
      return OffsetResetType.LATEST
    case 'timestamp':
      return OffsetResetType.TIMESTAMP
    default:
      return OffsetResetType.UNSPECIFIED
  }
}

// ============================================================================
// Authorization
// ============================================================================

type AccessResult = { ok: true } | { ok: false; error: string }

/**
 * Bifrost's admin gRPC has no tenant awareness, so every consumer-group call
 * is gated here: the caller must be authenticated and hold `verb` in the
 * workspace that owns the virtual cluster (directly, or via its application
 * for legacy clusters that predate the `workspace` field).
 */
async function authorizeVirtualCluster(
  virtualClusterId: string,
  verb: 'read' | 'manage',
): Promise<AccessResult> {
  const actor = await getActor()
  if (!actor) return { ok: false, error: 'Not authenticated' }

  const payload = await getPayload({ config })

  let workspaceId: string | null = null
  try {
    const vc = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: virtualClusterId,
      depth: 0,
      overrideAccess: true,
    })
    const relId = (v: unknown): string | null =>
      typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null
    workspaceId = relId(vc?.workspace)
    if (!workspaceId) {
      const appId = relId(vc?.application)
      if (appId) {
        const app = await payload.findByID({
          collection: 'kafka-applications',
          id: appId,
          depth: 0,
          overrideAccess: true,
        })
        workspaceId = relId(app?.workspace)
      }
    }
  } catch {
    return { ok: false, error: 'Virtual cluster not found' }
  }

  if (!workspaceId) return { ok: false, error: 'Virtual cluster not found' }

  const decision = await check(verb, { kind: 'workspace', id: workspaceId }, actor)
  if (!decision.allowed) {
    // A member who merely lacks the role gets a different message than an outsider.
    if (verb === 'manage') {
      const read = await check('read', { kind: 'workspace', id: workspaceId }, actor)
      if (read.allowed) {
        return { ok: false, error: 'Insufficient role: workspace owner or admin required' }
      }
    }
    return { ok: false, error: 'Not a member of this workspace' }
  }

  return { ok: true }
}

// ============================================================================
// Bifrost Sync Helper
// ============================================================================

/**
 * Ensures the virtual cluster config is synced to Bifrost.
 * This is needed because Bifrost stores configs in memory and loses them on restart.
 */
async function ensureVirtualClusterSynced(virtualClusterId: string): Promise<void> {
  const payload = await getPayload({ config })

  // Get the virtual cluster from the database
  const vc = await payload.findByID({
    collection: 'kafka-virtual-clusters',
    id: virtualClusterId,
    depth: 1, // Populate relationships
    overrideAccess: true,
  }) as KafkaVirtualCluster

  if (!vc) {
    throw new Error('Virtual cluster not found in database')
  }

  // Get application info
  const app = typeof vc.application === 'object' ? vc.application as KafkaApplication : undefined
  const physicalCluster = typeof vc.physicalCluster === 'object' ? vc.physicalCluster as KafkaCluster : undefined

  // Extract bootstrap servers from connection config
  let bootstrapServers = 'redpanda:9092' // Default for local dev
  if (physicalCluster?.connectionConfig && typeof physicalCluster.connectionConfig === 'object') {
    const connConfig = physicalCluster.connectionConfig as Record<string, unknown>
    if (typeof connConfig.bootstrapServers === 'string') {
      bootstrapServers = connConfig.bootstrapServers
    }
  }

  // Build the config and push to Bifrost
  await bifrostAdminClient.upsertVirtualCluster({
    config: {
      id: vc.id,
      applicationId: typeof vc.application === 'string' ? vc.application : app?.id || '',
      applicationSlug: app?.slug || '',
      workspaceSlug: '', // Not needed for consumer groups
      environment: vc.environment || '',
      topicPrefix: vc.topicPrefix || '',
      groupPrefix: vc.groupPrefix || '',
      transactionIdPrefix: vc.topicPrefix || '',
      advertisedHost: vc.advertisedHost || '',
      advertisedPort: vc.advertisedPort || 9092,
      physicalBootstrapServers: bootstrapServers,
      readOnly: vc.status === 'read_only',
    },
  })
}

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Lists all consumer groups for a virtual cluster.
 */
export async function listConsumerGroups(virtualClusterId: string): Promise<{
  success: boolean
  data?: ConsumerGroupSummary[]
  error?: string
}> {
  const access = await authorizeVirtualCluster(virtualClusterId, 'read')
  if (!access.ok) return { success: false, error: access.error }

  try {
    // Ensure the virtual cluster is synced to Bifrost (in case Bifrost restarted)
    await ensureVirtualClusterSynced(virtualClusterId)

    const response = await bifrostAdminClient.listConsumerGroups({
      virtualClusterId,
    })

    if (response.error) {
      return { success: false, error: response.error }
    }

    const groups: ConsumerGroupSummary[] = response.groups.map((g) => ({
      groupId: g.groupId,
      state: mapGroupState(g.state),
      memberCount: g.memberCount,
      topics: g.topics,
      totalLag: Number(g.totalLag),
    }))

    return { success: true, data: groups }
  } catch (error) {
    console.error('Failed to list consumer groups:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to list consumer groups'
    return { success: false, error: errorMessage }
  }
}

/**
 * Gets detailed information about a consumer group including partition-level lag.
 */
export async function describeConsumerGroup(
  virtualClusterId: string,
  groupId: string
): Promise<{
  success: boolean
  data?: ConsumerGroupDetail
  error?: string
}> {
  const access = await authorizeVirtualCluster(virtualClusterId, 'read')
  if (!access.ok) return { success: false, error: access.error }

  try {
    const response = await bifrostAdminClient.describeConsumerGroup({
      virtualClusterId,
      groupId,
    })

    if (response.error) {
      return { success: false, error: response.error }
    }

    if (!response.group) {
      return { success: false, error: 'Consumer group not found' }
    }

    const group: ConsumerGroupDetail = {
      groupId: response.group.groupId,
      state: mapGroupState(response.group.state),
      memberCount: response.group.memberCount,
      topics: response.group.topics,
      totalLag: Number(response.group.totalLag),
      partitions: response.group.partitions.map((p) => ({
        topic: p.topic,
        partition: p.partition,
        currentOffset: Number(p.currentOffset),
        endOffset: Number(p.endOffset),
        lag: Number(p.lag),
        consumerId: p.consumerId,
      })),
    }

    return { success: true, data: group }
  } catch (error) {
    console.error('Failed to describe consumer group:', error)
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to describe consumer group'
    return { success: false, error: errorMessage }
  }
}

/**
 * Resets offsets for a consumer group on a specific topic.
 * The group must be empty (no active consumers) for this to work.
 */
export async function resetConsumerGroupOffsets(
  virtualClusterId: string,
  groupId: string,
  topic: string,
  resetType: 'earliest' | 'latest' | 'timestamp',
  timestamp?: number
): Promise<{
  success: boolean
  newOffsets?: PartitionLag[]
  error?: string
}> {
  // Resetting offsets rewinds or skips a consumer group: owner/admin only.
  const access = await authorizeVirtualCluster(virtualClusterId, 'manage')
  if (!access.ok) return { success: false, error: access.error }

  try {
    const response = await bifrostAdminClient.resetConsumerGroupOffsets({
      virtualClusterId,
      groupId,
      topic,
      resetType: mapResetType(resetType),
      timestamp: timestamp ? BigInt(timestamp) : BigInt(0),
    })

    if (response.error) {
      return { success: false, error: response.error }
    }

    if (!response.success) {
      return { success: false, error: 'Failed to reset offsets' }
    }

    const newOffsets: PartitionLag[] = response.newOffsets.map((p) => ({
      topic: p.topic,
      partition: p.partition,
      currentOffset: Number(p.currentOffset),
      endOffset: Number(p.endOffset),
      lag: Number(p.lag),
      consumerId: p.consumerId,
    }))

    return { success: true, newOffsets }
  } catch (error) {
    console.error('Failed to reset consumer group offsets:', error)
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to reset consumer group offsets'
    return { success: false, error: errorMessage }
  }
}
