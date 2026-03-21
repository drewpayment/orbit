'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { getWorkspaceQuotaInfo as getQuotaInfo, type QuotaInfo } from '@/lib/kafka/quotas'

export interface GetWorkspaceQuotaInfoInput {
  workspaceId: string
}

export interface GetWorkspaceQuotaInfoResult {
  success: boolean
  quotaInfo?: QuotaInfo
  error?: string
}

/**
 * Get quota information for a workspace
 */
export async function getWorkspaceQuotaInfo(
  input: GetWorkspaceQuotaInfoInput
): Promise<GetWorkspaceQuotaInfoResult> {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify user is member of workspace
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: input.workspaceId } },
          { user: { equals: payloadUser.betterAuthId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Not a member of this workspace' }
    }

    const quotaInfo = await getQuotaInfo(payload, input.workspaceId)

    return { success: true, quotaInfo }
  } catch (error) {
    console.error('Error getting workspace quota info:', error)
    return { success: false, error: 'Failed to get quota info' }
  }
}

export interface SetWorkspaceQuotaOverrideInput {
  workspaceId: string
  newQuota: number
  reason: string
}

export interface SetWorkspaceQuotaOverrideResult {
  success: boolean
  error?: string
}

/**
 * Set or update a workspace's quota override (platform admin only)
 */
export async function setWorkspaceQuotaOverride(
  input: SetWorkspaceQuotaOverrideInput
): Promise<SetWorkspaceQuotaOverrideResult> {
  try {
    const payloadUser = await getPayloadUserFromSession()
    if (!payloadUser) {
      return { success: false, error: 'Not authenticated' }
    }

    const role = (payloadUser as any).role
    if (role !== 'super_admin' && role !== 'admin') {
      return { success: false, error: 'Forbidden: platform admin access required' }
    }

    const payload = await getPayload({ config })

    // Validate input
    if (input.newQuota < 1 || input.newQuota > 1000) {
      return { success: false, error: 'Quota must be between 1 and 1000' }
    }

    if (!input.reason || input.reason.trim().length === 0) {
      return { success: false, error: 'Reason is required' }
    }

    // Check if override already exists
    const existing = await payload.find({
      collection: 'kafka-application-quotas',
      where: {
        workspace: { equals: input.workspaceId },
      },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      // Update existing override
      await payload.update({
        collection: 'kafka-application-quotas',
        id: existing.docs[0].id,
        data: {
          applicationQuota: input.newQuota,
          reason: input.reason,
          setBy: payloadUser.betterAuthId,
        },
        user: payloadUser,
        overrideAccess: false,
      })
    } else {
      // Create new override
      await payload.create({
        collection: 'kafka-application-quotas',
        data: {
          workspace: input.workspaceId,
          applicationQuota: input.newQuota,
          reason: input.reason,
          setBy: payloadUser.betterAuthId,
        },
        user: payloadUser,
        overrideAccess: false,
      })
    }

    return { success: true }
  } catch (error) {
    console.error('Error setting workspace quota override:', error)
    return { success: false, error: 'Failed to set quota override' }
  }
}
