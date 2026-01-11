/**
 * Kafka Application Quota Management
 *
 * Provides functions for checking and managing workspace quotas
 * for Kafka applications.
 */

import type { Payload } from 'payload'

/**
 * System default quota for Kafka applications per workspace
 */
export const SYSTEM_DEFAULT_QUOTA = 5

/**
 * Quota information for a workspace
 */
export interface QuotaInfo {
  /** Number of active applications in the workspace */
  used: number
  /** Maximum allowed applications (override or system default) */
  quota: number
  /** Remaining applications that can be created */
  remaining: number
  /** Whether workspace has a quota override */
  hasOverride: boolean
}

/**
 * Get the effective quota for a workspace
 *
 * Checks for a workspace-specific override, otherwise returns system default.
 *
 * @param payload - Payload CMS instance
 * @param workspaceId - Workspace ID to check
 * @returns The effective quota for the workspace
 */
export async function getEffectiveQuota(
  payload: Payload,
  workspaceId: string
): Promise<number> {
  const override = await payload.find({
    collection: 'kafka-application-quotas',
    where: {
      workspace: { equals: workspaceId },
    },
    limit: 1,
    overrideAccess: true,
  })

  if (override.docs.length > 0) {
    return override.docs[0].applicationQuota
  }

  return SYSTEM_DEFAULT_QUOTA
}

/**
 * Get the current quota usage for a workspace
 *
 * Counts active applications (excludes decommissioning and deleted).
 *
 * @param payload - Payload CMS instance
 * @param workspaceId - Workspace ID to check
 * @returns Number of active applications
 */
export async function getQuotaUsage(
  payload: Payload,
  workspaceId: string
): Promise<number> {
  const result = await payload.count({
    collection: 'kafka-applications',
    where: {
      workspace: { equals: workspaceId },
      status: { equals: 'active' },
    },
    overrideAccess: true,
  })

  return result.totalDocs
}

/**
 * Check if workspace can create a new application
 *
 * @param payload - Payload CMS instance
 * @param workspaceId - Workspace ID to check
 * @returns True if workspace is under quota
 */
export async function canCreateApplication(
  payload: Payload,
  workspaceId: string
): Promise<boolean> {
  const [used, quota] = await Promise.all([
    getQuotaUsage(payload, workspaceId),
    getEffectiveQuota(payload, workspaceId),
  ])

  return used < quota
}

/**
 * Get full quota information for a workspace
 *
 * @param payload - Payload CMS instance
 * @param workspaceId - Workspace ID to check
 * @returns QuotaInfo object with usage details
 */
export async function getWorkspaceQuotaInfo(
  payload: Payload,
  workspaceId: string
): Promise<QuotaInfo> {
  const [usedCount, override] = await Promise.all([
    getQuotaUsage(payload, workspaceId),
    payload.find({
      collection: 'kafka-application-quotas',
      where: {
        workspace: { equals: workspaceId },
      },
      limit: 1,
      overrideAccess: true,
    }),
  ])

  const hasOverride = override.docs.length > 0
  const quota = hasOverride
    ? override.docs[0].applicationQuota
    : SYSTEM_DEFAULT_QUOTA

  return {
    used: usedCount,
    quota,
    remaining: Math.max(0, quota - usedCount),
    hasOverride,
  }
}

/**
 * Check if a workspace has a quota override
 *
 * @param payload - Payload CMS instance
 * @param workspaceId - Workspace ID to check
 * @returns True if workspace has a quota override
 */
export async function hasQuotaOverride(
  payload: Payload,
  workspaceId: string
): Promise<boolean> {
  const result = await payload.count({
    collection: 'kafka-application-quotas',
    where: {
      workspace: { equals: workspaceId },
    },
    overrideAccess: true,
  })

  return result.totalDocs > 0
}
