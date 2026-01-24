'use server'

import { bifrostAdminClient } from '@/lib/grpc/bifrost-admin-client'
import {
  ConsumerGroupState,
  OffsetResetType,
} from '@/lib/proto/idp/gateway/v1/gateway_pb'

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
  try {
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
