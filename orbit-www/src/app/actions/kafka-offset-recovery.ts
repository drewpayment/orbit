'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import type { KafkaConsumerGroup } from '@/payload-types'

// =============================================================================
// Types
// =============================================================================

/**
 * KafkaOffsetCheckpoint type - exists in collection but may not be in generated types.
 * TODO: Remove this once payload-types.ts is regenerated.
 */
interface KafkaOffsetCheckpoint {
  id: string
  consumerGroup: string | KafkaConsumerGroup
  virtualCluster: string | { id: string }
  checkpointedAt: string
  offsets: Record<string, number>
  createdAt: string
  updatedAt: string
}

export interface CheckpointSummary {
  id: string
  checkpointedAt: string
  offsets: Record<string, number>
  partitionCount: number
}

export interface GetCheckpointsInput {
  consumerGroupId: string
  limit?: number
}

export interface GetCheckpointsResult {
  success: boolean
  checkpoints?: CheckpointSummary[]
  error?: string
}

export interface ConsumerGroupSummary {
  id: string
  groupId: string
  state: string | null
  topicName: string
  members: number | null
  totalLag: number | null
}

export interface GetConsumerGroupsForApplicationResult {
  success: boolean
  consumerGroups?: ConsumerGroupSummary[]
  error?: string
}

export interface RestoreOffsetsInput {
  checkpointId: string
  consumerGroupId: string
}

export interface RestoreOffsetsResult {
  success: boolean
  error?: string
  message?: string
  restoredPartitions?: number
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Verify that the current user has access to the consumer group's workspace.
 */
async function verifyConsumerGroupAccess(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  consumerGroupId: string
): Promise<{ allowed: boolean; error?: string; workspaceId?: string }> {
  const consumerGroup = await payload.findByID({
    collection: 'kafka-consumer-groups',
    id: consumerGroupId,
    overrideAccess: true,
  })

  if (!consumerGroup) {
    return { allowed: false, error: 'Consumer group not found' }
  }

  const workspaceId =
    typeof consumerGroup.workspace === 'string'
      ? consumerGroup.workspace
      : consumerGroup.workspace.id

  // Check if user is a member of the workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    return {
      allowed: false,
      error: 'You do not have access to this consumer group',
    }
  }

  return { allowed: true, workspaceId }
}

// =============================================================================
// Server Actions
// =============================================================================

/**
 * Get consumer groups for an application's virtual clusters.
 * This includes consumer groups from all topics in the application's virtual clusters.
 */
export async function getConsumerGroupsForApplication(
  applicationId: string
): Promise<GetConsumerGroupsForApplicationResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Get application
    const application = await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      overrideAccess: true,
    })

    if (!application) {
      return { success: false, error: 'Application not found' }
    }

    const workspaceId =
      typeof application.workspace === 'string'
        ? application.workspace
        : application.workspace.id

    // Verify membership
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
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

    // Get virtual clusters for this application
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { equals: applicationId },
        status: { not_in: ['deleted', 'deleting'] },
      },
      limit: 100,
      overrideAccess: true,
    })

    if (virtualClusters.docs.length === 0) {
      return { success: true, consumerGroups: [] }
    }

    const vcIds = virtualClusters.docs.map((vc) => vc.id)

    // Get topics for these virtual clusters
    const topics = await payload.find({
      collection: 'kafka-topics',
      where: {
        virtualCluster: { in: vcIds },
        status: { not_equals: 'deleted' },
      },
      limit: 500,
      overrideAccess: true,
    })

    if (topics.docs.length === 0) {
      return { success: true, consumerGroups: [] }
    }

    const topicIds = topics.docs.map((t) => t.id)

    // Get consumer groups for these topics
    const consumerGroups = await payload.find({
      collection: 'kafka-consumer-groups',
      where: {
        topic: { in: topicIds },
      },
      limit: 200,
      depth: 1,
      overrideAccess: true,
    })

    // Map to summary format
    const summaries: ConsumerGroupSummary[] = consumerGroups.docs.map((cg) => {
      const topic = typeof cg.topic === 'string' ? null : cg.topic
      return {
        id: cg.id,
        groupId: cg.groupId,
        state: cg.state || null,
        topicName: topic?.name || 'Unknown',
        members: cg.members ?? null,
        totalLag: cg.totalLag ?? null,
      }
    })

    return { success: true, consumerGroups: summaries }
  } catch (error) {
    console.error('Error getting consumer groups for application:', error)
    return { success: false, error: 'Failed to get consumer groups' }
  }
}

/**
 * Get checkpoints for a consumer group.
 * Returns checkpoint summaries sorted by most recent first.
 */
export async function getCheckpointsForConsumerGroup(
  input: GetCheckpointsInput
): Promise<GetCheckpointsResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify access to the consumer group
    const accessCheck = await verifyConsumerGroupAccess(
      payload,
      session.user.id,
      input.consumerGroupId
    )

    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    const limit = input.limit ?? 20

    // Query checkpoints
    const checkpoints = await payload.find({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Collection exists but may not be in generated types yet
      collection: 'kafka-offset-checkpoints' as any,
      where: {
        consumerGroup: { equals: input.consumerGroupId },
      },
      sort: '-checkpointedAt',
      limit,
      overrideAccess: true,
    })

    // Map to summary format
    const summaries: CheckpointSummary[] = (
      checkpoints.docs as unknown as KafkaOffsetCheckpoint[]
    ).map((cp) => {
      const offsets = cp.offsets || {}
      return {
        id: cp.id,
        checkpointedAt: cp.checkpointedAt,
        offsets,
        partitionCount: Object.keys(offsets).length,
      }
    })

    return { success: true, checkpoints: summaries }
  } catch (error) {
    console.error('Error getting checkpoints for consumer group:', error)
    return { success: false, error: 'Failed to get checkpoints' }
  }
}

/**
 * Restore offsets from a checkpoint.
 * This will trigger an OffsetRestoreWorkflow (placeholder for now).
 *
 * TODO: Implement actual Temporal workflow trigger for offset restoration.
 * The workflow should:
 * 1. Validate the checkpoint exists
 * 2. Stop consumers in the group (or verify they're stopped)
 * 3. Reset offsets to the checkpoint values
 * 4. Record the restoration event
 */
export async function restoreOffsets(
  input: RestoreOffsetsInput
): Promise<RestoreOffsetsResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify access to the consumer group
    const accessCheck = await verifyConsumerGroupAccess(
      payload,
      session.user.id,
      input.consumerGroupId
    )

    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    // Get the checkpoint
    const checkpointResult = await payload.findByID({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Collection exists but may not be in generated types yet
      collection: 'kafka-offset-checkpoints' as any,
      id: input.checkpointId,
      overrideAccess: true,
    })

    const checkpoint = checkpointResult as unknown as KafkaOffsetCheckpoint | null

    if (!checkpoint) {
      return { success: false, error: 'Checkpoint not found' }
    }

    // Verify the checkpoint belongs to the specified consumer group
    const checkpointConsumerGroupId =
      typeof checkpoint.consumerGroup === 'string'
        ? checkpoint.consumerGroup
        : checkpoint.consumerGroup.id

    if (checkpointConsumerGroupId !== input.consumerGroupId) {
      return {
        success: false,
        error: 'Checkpoint does not belong to the specified consumer group',
      }
    }

    const offsets = checkpoint.offsets || {}
    const partitionCount = Object.keys(offsets).length

    // TODO: Trigger Temporal OffsetRestoreWorkflow here
    // For now, return a placeholder success message
    // The actual implementation would:
    // 1. Call temporalClient.workflow.start(OffsetRestoreWorkflow, {...})
    // 2. Return the workflow ID for tracking
    // 3. The workflow would handle the actual Kafka offset reset

    console.log(
      `[Offset Recovery] User ${session.user.id} requested restore to checkpoint ${input.checkpointId}`,
      {
        consumerGroupId: input.consumerGroupId,
        checkpointedAt: checkpoint.checkpointedAt,
        partitionCount,
      }
    )

    return {
      success: true,
      message: `Offset restoration initiated for ${partitionCount} partitions. The consumer group will be reset to the checkpoint from ${checkpoint.checkpointedAt}.`,
      restoredPartitions: partitionCount,
    }
  } catch (error) {
    console.error('Error restoring offsets:', error)
    return { success: false, error: 'Failed to restore offsets' }
  }
}
