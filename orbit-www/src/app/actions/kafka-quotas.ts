'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
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
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Check if user is platform admin (users collection = admins)
    const user = await payload.findByID({
      collection: 'users',
      id: session.user.id,
      overrideAccess: true,
    })

    if (!user) {
      return { success: false, error: 'Only platform admins can set quota overrides' }
    }

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
          setBy: session.user.id,
        },
        overrideAccess: true,
      })
    } else {
      // Create new override
      await payload.create({
        collection: 'kafka-application-quotas',
        data: {
          workspace: input.workspaceId,
          applicationQuota: input.newQuota,
          reason: input.reason,
          setBy: session.user.id,
        },
        overrideAccess: true,
      })
    }

    return { success: true }
  } catch (error) {
    console.error('Error setting workspace quota override:', error)
    return { success: false, error: 'Failed to set quota override' }
  }
}
