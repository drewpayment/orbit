'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

// ============================================================================
// Type Definitions
// ============================================================================

export type ApproveShareInput = {
  shareId: string
}

export type ApproveShareResult = {
  success: boolean
  error?: string
}

export type RejectShareInput = {
  shareId: string
  reason: string
}

export type RejectShareResult = {
  success: boolean
  error?: string
}

export type RevokeShareInput = {
  shareId: string
}

export type RevokeShareResult = {
  success: boolean
  error?: string
}

export type ListPendingSharesInput = {
  workspaceId: string
  type: 'incoming' | 'outgoing'
}

export type ShareListItem = {
  id: string
  topic: {
    id: string
    name: string
    environment: string
  }
  ownerWorkspace: {
    id: string
    name: string
  }
  targetWorkspace: {
    id: string
    name: string
  }
  accessLevel: 'read' | 'write' | 'read-write'
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired'
  reason?: string | null
  requestedBy: {
    id: string
    email: string
  }
  requestedAt: string
}

export type ListPendingSharesResult = {
  success: boolean
  shares?: ShareListItem[]
  error?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if user is owner or admin of the specified workspace
 */
async function isWorkspaceOwnerOrAdmin(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  return members.docs.length > 0
}

/**
 * Check if user is a member of the specified workspace
 */
async function isWorkspaceMember(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const members = await payload.find({
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

  return members.docs.length > 0
}

/**
 * Trigger workflow for approved share (placeholder for Temporal integration)
 */
async function triggerShareApprovedWorkflow(
  share: { id: string; topic: { id: string; name: string } }
): Promise<void> {
  // TODO: Implement Temporal client call
  console.log('Triggering ShareApprovedWorkflow:', {
    shareId: share.id,
    topicId: share.topic.id,
    topicName: share.topic.name,
  })
}

/**
 * Trigger workflow for revoked share (placeholder for Temporal integration)
 */
async function triggerShareRevokedWorkflow(
  share: { id: string; topic: { id: string; name: string } }
): Promise<void> {
  // TODO: Implement Temporal client call
  console.log('Triggering ShareRevokedWorkflow:', {
    shareId: share.id,
    topicId: share.topic.id,
    topicName: share.topic.name,
  })
}

/**
 * Send notification for rejected share (placeholder for notification system)
 */
async function sendShareRejectedNotification(
  share: { id: string; topic: { id: string; name: string }; requestedBy?: { id: string; email?: string } },
  reason: string
): Promise<void> {
  // TODO: Implement notification system integration
  console.log('Sending share rejected notification:', {
    shareId: share.id,
    topicName: share.topic.name,
    requestedBy: share.requestedBy?.email,
    reason,
  })
}

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Approve a pending share request
 *
 * Only owner/admin of the owner workspace can approve shares
 */
export async function approveShare(
  input: ApproveShareInput
): Promise<ApproveShareResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Get the share
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      depth: 2,
      overrideAccess: true,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    // Verify share is in pending status
    if (share.status !== 'pending') {
      return { success: false, error: 'Share is not pending approval' }
    }

    // Get owner workspace ID
    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id

    // Verify user is owner/admin of owner workspace
    const isAuthorized = await isWorkspaceOwnerOrAdmin(payload, userId, ownerWorkspaceId)
    if (!isAuthorized) {
      return { success: false, error: 'Not authorized to approve this share' }
    }

    // Update the share status to approved
    await payload.update({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      data: {
        status: 'approved',
        approvedBy: userId,
        approvedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    // Get topic info for workflow
    const topic = typeof share.topic === 'string'
      ? { id: share.topic, name: 'Unknown' }
      : { id: share.topic.id, name: share.topic.name ?? 'Unknown' }

    // Trigger approval workflow
    await triggerShareApprovedWorkflow({
      id: share.id,
      topic,
    })

    // Revalidate share-related pages
    revalidatePath('/topics/catalog')
    revalidatePath('/topics/shared')

    return { success: true }
  } catch (error) {
    console.error('Failed to approve share:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Reject a pending share request
 *
 * Only owner/admin of the owner workspace can reject shares
 */
export async function rejectShare(
  input: RejectShareInput
): Promise<RejectShareResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Get the share
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      depth: 2,
      overrideAccess: true,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    // Verify share is in pending status
    if (share.status !== 'pending') {
      return { success: false, error: 'Can only reject pending shares' }
    }

    // Get owner workspace ID
    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id

    // Verify user is owner/admin of owner workspace
    const isAuthorized = await isWorkspaceOwnerOrAdmin(payload, userId, ownerWorkspaceId)
    if (!isAuthorized) {
      return { success: false, error: 'Not authorized to reject this share' }
    }

    // Update the share status to rejected
    await payload.update({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      data: {
        status: 'rejected',
        rejectionReason: input.reason,
      },
      overrideAccess: true,
    })

    // Get topic info for notification
    const topic = typeof share.topic === 'string'
      ? { id: share.topic, name: 'Unknown' }
      : { id: share.topic.id, name: share.topic.name ?? 'Unknown' }

    // Get requester info
    const requestedBy = share.requestedBy
      ? typeof share.requestedBy === 'string'
        ? { id: share.requestedBy }
        : { id: share.requestedBy.id, email: share.requestedBy.email }
      : undefined

    // Send rejection notification
    await sendShareRejectedNotification(
      {
        id: share.id,
        topic,
        requestedBy,
      },
      input.reason
    )

    // Revalidate share-related pages
    revalidatePath('/topics/catalog')
    revalidatePath('/topics/shared')

    return { success: true }
  } catch (error) {
    console.error('Failed to reject share:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Revoke an approved share
 *
 * Only owner/admin of the owner workspace can revoke shares
 */
export async function revokeShare(
  input: RevokeShareInput
): Promise<RevokeShareResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Get the share
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      depth: 2,
      overrideAccess: true,
    })

    if (!share) {
      return { success: false, error: 'Share not found' }
    }

    // Verify share is in approved status
    if (share.status !== 'approved') {
      return { success: false, error: 'Can only revoke approved shares' }
    }

    // Get owner workspace ID
    const ownerWorkspaceId = typeof share.ownerWorkspace === 'string'
      ? share.ownerWorkspace
      : share.ownerWorkspace.id

    // Verify user is owner/admin of owner workspace
    const isAuthorized = await isWorkspaceOwnerOrAdmin(payload, userId, ownerWorkspaceId)
    if (!isAuthorized) {
      return { success: false, error: 'Not authorized to revoke this share' }
    }

    // Update the share status to revoked
    await payload.update({
      collection: 'kafka-topic-shares',
      id: input.shareId,
      data: {
        status: 'revoked',
      },
      overrideAccess: true,
    })

    // Get topic info for workflow
    const topic = typeof share.topic === 'string'
      ? { id: share.topic, name: 'Unknown' }
      : { id: share.topic.id, name: share.topic.name ?? 'Unknown' }

    // Trigger revoke workflow
    await triggerShareRevokedWorkflow({
      id: share.id,
      topic,
    })

    // Revalidate share-related pages
    revalidatePath('/topics/catalog')
    revalidatePath('/topics/shared')

    return { success: true }
  } catch (error) {
    console.error('Failed to revoke share:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * List pending shares for a workspace
 *
 * - 'incoming': Lists pending shares where workspace is the owner (requests TO approve)
 * - 'outgoing': Lists pending shares where workspace is the target (requests user MADE)
 */
export async function listPendingShares(
  input: ListPendingSharesInput
): Promise<ListPendingSharesResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })
  const userId = session.user.id

  try {
    // Verify user is a member of the workspace
    const isMember = await isWorkspaceMember(payload, userId, input.workspaceId)
    if (!isMember) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    // Build query based on type
    const workspaceCondition = input.type === 'incoming'
      ? { ownerWorkspace: { equals: input.workspaceId } }
      : { targetWorkspace: { equals: input.workspaceId } }

    // Query shares
    const sharesResult = await payload.find({
      collection: 'kafka-topic-shares',
      where: {
        and: [
          workspaceCondition,
          { status: { equals: 'pending' } },
        ],
      },
      sort: '-createdAt',
      depth: 2,
      limit: 100,
      overrideAccess: true,
    })

    // Transform to ShareListItem format
    const shares: ShareListItem[] = sharesResult.docs.map(share => {
      // Extract topic info
      const topic = typeof share.topic === 'string'
        ? { id: share.topic, name: 'Unknown', environment: 'unknown' }
        : {
            id: share.topic.id,
            name: share.topic.name ?? 'Unknown',
            environment: share.topic.environment ?? 'unknown',
          }

      // Extract owner workspace info
      const ownerWorkspace = typeof share.ownerWorkspace === 'string'
        ? { id: share.ownerWorkspace, name: 'Unknown' }
        : { id: share.ownerWorkspace.id, name: share.ownerWorkspace.name ?? 'Unknown' }

      // Extract target workspace info
      const targetWorkspace = typeof share.targetWorkspace === 'string'
        ? { id: share.targetWorkspace, name: 'Unknown' }
        : { id: share.targetWorkspace.id, name: share.targetWorkspace.name ?? 'Unknown' }

      // Extract requestedBy info
      const requestedBy = share.requestedBy
        ? typeof share.requestedBy === 'string'
          ? { id: share.requestedBy, email: 'Unknown' }
          : { id: share.requestedBy.id, email: share.requestedBy.email ?? 'Unknown' }
        : { id: 'Unknown', email: 'Unknown' }

      return {
        id: share.id,
        topic,
        ownerWorkspace,
        targetWorkspace,
        accessLevel: share.accessLevel as ShareListItem['accessLevel'],
        status: share.status as ShareListItem['status'],
        reason: share.reason,
        requestedBy,
        requestedAt: share.createdAt,
      }
    })

    return {
      success: true,
      shares,
    }
  } catch (error) {
    console.error('Failed to list pending shares:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
