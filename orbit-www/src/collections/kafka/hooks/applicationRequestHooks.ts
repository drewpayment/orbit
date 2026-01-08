/**
 * Hooks for KafkaApplicationRequests collection
 *
 * Handles:
 * - Notifications on status changes
 * - Application creation on approval
 * - Quota override creation on 'increased_quota' action
 */

import type { CollectionAfterChangeHook, Payload } from 'payload'
import { sendNotification, createNotification } from '@/lib/notifications'
import { SYSTEM_DEFAULT_QUOTA } from '@/lib/kafka/quotas'

interface RequestDoc {
  id: string
  applicationName: string
  applicationSlug: string
  description?: string
  workspace: string | { id: string; name?: string }
  requestedBy: string | { id: string; name?: string; email?: string }
  status: 'pending_workspace' | 'pending_platform' | 'approved' | 'rejected'
  workspaceApprovedBy?: string | { id: string; name?: string; email?: string }
  workspaceApprovedAt?: string
  platformApprovedBy?: string | { id: string; name?: string; email?: string }
  platformApprovedAt?: string
  platformAction?: 'approved_single' | 'increased_quota'
  rejectedBy?: string | { id: string; name?: string; email?: string }
  rejectedAt?: string
  rejectionReason?: string
}

/**
 * Get user info (id, name, email) from a relationship field
 */
async function getUserInfo(
  payload: Payload,
  user: string | { id: string; name?: string; email?: string } | undefined
): Promise<{ id: string; name: string; email: string } | null> {
  if (!user) return null

  if (typeof user === 'string') {
    const userDoc = await payload.findByID({
      collection: 'users',
      id: user,
      overrideAccess: true,
    })
    return userDoc
      ? {
          id: userDoc.id,
          name: userDoc.name || 'Unknown',
          email: userDoc.email || '',
        }
      : null
  }

  return {
    id: user.id,
    name: user.name || 'Unknown',
    email: user.email || '',
  }
}

/**
 * Get workspace info from a relationship field
 */
async function getWorkspaceInfo(
  payload: Payload,
  workspace: string | { id: string; name?: string }
): Promise<{ id: string; name: string }> {
  if (typeof workspace === 'string') {
    const wsDoc = await payload.findByID({
      collection: 'workspaces',
      id: workspace,
      overrideAccess: true,
    })
    return {
      id: workspace,
      name: wsDoc?.name || 'Unknown Workspace',
    }
  }

  return {
    id: workspace.id,
    name: workspace.name || 'Unknown Workspace',
  }
}

/**
 * Get workspace admins for notifications
 */
async function getWorkspaceAdmins(
  payload: Payload,
  workspaceId: string
): Promise<{ id: string; name: string; email: string }[]> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    depth: 1,
    limit: 100,
    overrideAccess: true,
  })

  const admins: { id: string; name: string; email: string }[] = []
  for (const member of members.docs) {
    const user = member.user as { id: string; name?: string; email?: string } | string
    if (typeof user === 'object' && user.email) {
      admins.push({
        id: user.id,
        name: user.name || 'Unknown',
        email: user.email,
      })
    }
  }

  return admins
}

/**
 * Get platform admins for notifications
 * In this system, all users in the 'users' collection are platform admins
 */
async function getPlatformAdmins(
  payload: Payload
): Promise<{ id: string; name: string; email: string }[]> {
  const users = await payload.find({
    collection: 'users',
    limit: 100,
    overrideAccess: true,
  })

  return users.docs
    .filter((u) => u.email)
    .map((u) => ({
      id: u.id,
      name: u.name || 'Unknown',
      email: u.email,
    }))
}

/**
 * Notify workspace admins about a new request
 */
async function notifyWorkspaceAdmins(
  payload: Payload,
  doc: RequestDoc,
  workspaceInfo: { id: string; name: string },
  requesterInfo: { id: string; name: string; email: string }
): Promise<void> {
  const admins = await getWorkspaceAdmins(payload, workspaceInfo.id)

  // Don't notify the requester if they're an admin
  const adminsToNotify = admins.filter((a) => a.id !== requesterInfo.id)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const approvalUrl = `${baseUrl}/${workspaceInfo.name}/kafka/pending-approvals`

  for (const admin of adminsToNotify) {
    const notification = createNotification(
      { email: admin.email, name: admin.name },
      'approval-needed',
      {
        applicationName: doc.applicationName,
        workspaceName: workspaceInfo.name,
        requesterName: requesterInfo.name,
        requestId: doc.id,
        tier: 'workspace',
        approvalUrl,
      }
    )

    await sendNotification(payload, notification)
  }
}

/**
 * Notify platform admins about a request pending platform approval
 */
async function notifyPlatformAdmins(
  payload: Payload,
  doc: RequestDoc,
  workspaceInfo: { id: string; name: string },
  requesterInfo: { id: string; name: string; email: string }
): Promise<void> {
  const admins = await getPlatformAdmins(payload)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const approvalUrl = `${baseUrl}/platform/kafka/pending-approvals`

  for (const admin of admins) {
    const notification = createNotification(
      { email: admin.email, name: admin.name },
      'approval-needed',
      {
        applicationName: doc.applicationName,
        workspaceName: workspaceInfo.name,
        requesterName: requesterInfo.name,
        requestId: doc.id,
        tier: 'platform',
        approvalUrl,
      }
    )

    await sendNotification(payload, notification)
  }
}

/**
 * Notify requester about approval
 */
async function notifyRequesterApproved(
  payload: Payload,
  doc: RequestDoc,
  workspaceInfo: { id: string; name: string },
  requesterInfo: { id: string; name: string; email: string },
  approverInfo: { id: string; name: string; email: string }
): Promise<void> {
  const notification = createNotification(
    { email: requesterInfo.email, name: requesterInfo.name },
    'request-approved',
    {
      applicationName: doc.applicationName,
      workspaceName: workspaceInfo.name,
      approverName: approverInfo.name,
      platformAction: doc.platformAction,
    }
  )

  await sendNotification(payload, notification)
}

/**
 * Notify requester about rejection
 */
async function notifyRequesterRejected(
  payload: Payload,
  doc: RequestDoc,
  workspaceInfo: { id: string; name: string },
  requesterInfo: { id: string; name: string; email: string },
  rejectedByInfo: { id: string; name: string; email: string },
  tier: 'workspace' | 'platform'
): Promise<void> {
  const notification = createNotification(
    { email: requesterInfo.email, name: requesterInfo.name },
    'request-rejected',
    {
      applicationName: doc.applicationName,
      workspaceName: workspaceInfo.name,
      rejectedByName: rejectedByInfo.name,
      rejectionReason: doc.rejectionReason,
      tier,
    }
  )

  await sendNotification(payload, notification)
}

/**
 * Create the Kafka application from an approved request
 */
async function createApplicationFromRequest(
  payload: Payload,
  doc: RequestDoc,
  workspaceId: string
): Promise<void> {
  const requestedById =
    typeof doc.requestedBy === 'string' ? doc.requestedBy : doc.requestedBy.id

  await payload.create({
    collection: 'kafka-applications',
    data: {
      name: doc.applicationName,
      slug: doc.applicationSlug,
      description: doc.description || '',
      workspace: workspaceId,
      status: 'active',
      createdBy: requestedById,
    },
    overrideAccess: true,
  })

  // TODO: Trigger Temporal workflow to provision virtual clusters
}

/**
 * Create or update workspace quota override
 */
async function createOrUpdateQuotaOverride(
  payload: Payload,
  workspaceId: string,
  approverUserId: string
): Promise<void> {
  // Check if override already exists
  const existing = await payload.find({
    collection: 'kafka-application-quotas',
    where: {
      workspace: { equals: workspaceId },
    },
    limit: 1,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    // Increment existing quota by 1
    const currentQuota = existing.docs[0].applicationQuota
    await payload.update({
      collection: 'kafka-application-quotas',
      id: existing.docs[0].id,
      data: {
        applicationQuota: currentQuota + 1,
        reason: `Quota increased via approval workflow (was ${currentQuota})`,
        setBy: approverUserId,
      },
      overrideAccess: true,
    })
  } else {
    // Create new override with default + 1
    await payload.create({
      collection: 'kafka-application-quotas',
      data: {
        workspace: workspaceId,
        applicationQuota: SYSTEM_DEFAULT_QUOTA + 1,
        reason: 'Quota increased via approval workflow',
        setBy: approverUserId,
      },
      overrideAccess: true,
    })
  }
}

/**
 * Main afterChange hook for KafkaApplicationRequests
 */
export const afterChangeHook: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const payload = req.payload
  const typedDoc = doc as unknown as RequestDoc
  const typedPrevDoc = previousDoc as unknown as RequestDoc | undefined

  try {
    // Get common info
    const workspaceInfo = await getWorkspaceInfo(payload, typedDoc.workspace)
    const requesterInfo = await getUserInfo(payload, typedDoc.requestedBy)

    if (!requesterInfo) {
      console.error('Could not get requester info for request:', typedDoc.id)
      return doc
    }

    if (operation === 'create') {
      // New request submitted - notify workspace admins
      await notifyWorkspaceAdmins(payload, typedDoc, workspaceInfo, requesterInfo)
    }

    if (operation === 'update' && typedPrevDoc) {
      const prevStatus = typedPrevDoc.status
      const newStatus = typedDoc.status

      // Status: pending_workspace → pending_platform (workspace approved)
      if (prevStatus === 'pending_workspace' && newStatus === 'pending_platform') {
        await notifyPlatformAdmins(payload, typedDoc, workspaceInfo, requesterInfo)
      }

      // Status: pending_platform → approved
      if (prevStatus === 'pending_platform' && newStatus === 'approved') {
        const approverInfo = await getUserInfo(payload, typedDoc.platformApprovedBy)

        if (approverInfo) {
          // Create the application
          await createApplicationFromRequest(payload, typedDoc, workspaceInfo.id)

          // If action is 'increased_quota', also update/create quota override
          if (typedDoc.platformAction === 'increased_quota') {
            await createOrUpdateQuotaOverride(payload, workspaceInfo.id, approverInfo.id)
          }

          // Notify requester
          await notifyRequesterApproved(
            payload,
            typedDoc,
            workspaceInfo,
            requesterInfo,
            approverInfo
          )
        }
      }

      // Status: * → rejected
      if (prevStatus !== 'rejected' && newStatus === 'rejected') {
        const rejectedByInfo = await getUserInfo(payload, typedDoc.rejectedBy)

        if (rejectedByInfo) {
          // Determine which tier rejected
          const tier = prevStatus === 'pending_workspace' ? 'workspace' : 'platform'

          await notifyRequesterRejected(
            payload,
            typedDoc,
            workspaceInfo,
            requesterInfo,
            rejectedByInfo,
            tier
          )
        }
      }
    }
  } catch (error) {
    // Log but don't fail the operation - notifications are non-critical
    console.error('Error in KafkaApplicationRequests afterChange hook:', error)
  }

  return doc
}
