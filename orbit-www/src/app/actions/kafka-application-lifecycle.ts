'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTemporalClient } from '@/lib/temporal/client'
import {
  calculateGracePeriodEnd,
  calculateLifecycleState,
  type LifecycleState,
} from '@/lib/kafka/lifecycle'
import type { KafkaApplication } from '@/payload-types'

// ============================================================================
// Types
// ============================================================================

/**
 * Extended KafkaApplication type with lifecycle fields.
 * These fields exist in the collection but may not be in generated types yet.
 * TODO: Remove this once payload-types.ts is regenerated.
 */
interface KafkaApplicationWithLifecycle extends KafkaApplication {
  gracePeriodEndsAt?: string | null
  gracePeriodDaysOverride?: number | null
  cleanupWorkflowId?: string | null
  decommissionWorkflowId?: string | null
  decommissionReason?: string | null
}

/**
 * Workflow input type matching Go ApplicationDecommissioningInput struct.
 * Field names use camelCase to match Go JSON tags.
 */
type ApplicationDecommissioningWorkflowInput = {
  applicationId: string
  workspaceId: string
  gracePeriodEndsAt: string // ISO8601 timestamp
  forceDelete: boolean
  reason?: string
}

export interface DecommissionApplicationInput {
  applicationId: string
  reason?: string
  gracePeriodDaysOverride?: number
}

export interface DecommissionApplicationResult {
  success: boolean
  error?: string
  gracePeriodEndsAt?: string
  affectedVirtualClusters?: number
}

export interface CancelDecommissioningResult {
  success: boolean
  error?: string
  restoredVirtualClusters?: number
}

export interface ForceDeleteApplicationResult {
  success: boolean
  error?: string
  deletedTopics?: number
  deletedVirtualClusters?: number
}

export interface ApplicationLifecycleStatusResult {
  success: boolean
  error?: string
  lifecycle?: LifecycleState
  applicationName?: string
  applicationSlug?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify that the current user has admin/owner access to the application's workspace.
 */
async function verifyWorkspaceAdminAccess(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  applicationId: string
): Promise<{ allowed: boolean; error?: string; workspaceId?: string }> {
  // Fetch the application
  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
    overrideAccess: true,
  })

  if (!app) {
    return { allowed: false, error: 'Application not found' }
  }

  const workspaceId =
    typeof app.workspace === 'string' ? app.workspace : app.workspace.id

  // Check if user is admin/owner of the workspace
  const membership = await payload.find({
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

  if (membership.docs.length === 0) {
    return {
      allowed: false,
      error: 'You must be an admin or owner of this workspace',
    }
  }

  return { allowed: true, workspaceId }
}

/**
 * Trigger the ApplicationDecommissioningWorkflow in Temporal.
 *
 * @param applicationId - Application ID (used for workflow ID)
 * @param input - Workflow input matching Go struct
 * @returns Workflow ID if started successfully, null otherwise
 */
async function triggerDecommissioningWorkflow(
  applicationId: string,
  input: ApplicationDecommissioningWorkflowInput
): Promise<string | null> {
  const workflowId = `app-decommission-${applicationId}`

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('ApplicationDecommissioningWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [input],
    })

    console.log(
      `[Kafka] Started ApplicationDecommissioningWorkflow: ${handle.workflowId} for application ${applicationId}`
    )

    return handle.workflowId
  } catch (error) {
    console.error('[Kafka] Failed to start ApplicationDecommissioningWorkflow:', error)
    return null
  }
}

/**
 * Cancel a scheduled cleanup workflow by deleting the Temporal schedule.
 *
 * @param applicationId - Application ID (schedule ID is `cleanup-{applicationId}`)
 * @returns true if schedule was deleted, false if it didn't exist or deletion failed
 */
async function cancelCleanupSchedule(applicationId: string): Promise<boolean> {
  const scheduleId = `cleanup-${applicationId}`

  try {
    const client = await getTemporalClient()
    const scheduleHandle = client.schedule.getHandle(scheduleId)
    await scheduleHandle.delete()
    console.log(`[Kafka] Deleted cleanup schedule: ${scheduleId}`)
    return true
  } catch (error) {
    // Schedule may not exist, which is fine
    console.log(`[Kafka] Could not delete schedule ${scheduleId}:`, error)
    return false
  }
}

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Start decommissioning an application.
 *
 * This action:
 * 1. Sets the application status to 'decommissioning'
 * 2. Calculates and sets the grace period end date
 * 3. Sets all virtual clusters to 'read_only' mode
 * 4. Records the decommissioning timestamp and reason
 *
 * @param input - Decommissioning parameters
 * @returns Result with grace period information
 */
export async function decommissionApplication(
  input: DecommissionApplicationInput
): Promise<DecommissionApplicationResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify admin access
    const accessCheck = await verifyWorkspaceAdminAccess(
      payload,
      session.user.id,
      input.applicationId
    )

    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    // Validate input
    if (input.gracePeriodDaysOverride !== undefined) {
      if (input.gracePeriodDaysOverride < 1) {
        return { success: false, error: 'Grace period must be at least 1 day' }
      }
      if (input.gracePeriodDaysOverride > 365) {
        return { success: false, error: 'Grace period cannot exceed 365 days' }
      }
    }

    // Get current application state
    const app = (await payload.findByID({
      collection: 'kafka-applications',
      id: input.applicationId,
      overrideAccess: true,
    })) as KafkaApplicationWithLifecycle | null

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    if (app.status === 'deleted') {
      return { success: false, error: 'Application is already deleted' }
    }

    if (app.status === 'decommissioning') {
      return { success: false, error: 'Application is already being decommissioned' }
    }

    // Get all virtual clusters for this application
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { equals: input.applicationId },
        status: { not_in: ['deleted', 'deleting'] },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Calculate grace period based on environments
    const environments = virtualClusters.docs.map((vc) => vc.environment)
    const now = new Date()
    const gracePeriodEndsAt = calculateGracePeriodEnd(
      now,
      environments,
      input.gracePeriodDaysOverride
    )

    // Update application status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lifecycle fields exist in collection but may not be in generated types yet
    await payload.update({
      collection: 'kafka-applications',
      id: input.applicationId,
      data: {
        status: 'decommissioning',
        decommissioningStartedAt: now.toISOString(),
        gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
        gracePeriodDaysOverride: input.gracePeriodDaysOverride,
        decommissionReason: input.reason,
      } as any,
      overrideAccess: true,
    })

    // Set all virtual clusters to read_only
    let affectedClusters = 0
    for (const vc of virtualClusters.docs) {
      if (vc.status === 'active') {
        await payload.update({
          collection: 'kafka-virtual-clusters',
          id: vc.id,
          data: {
            status: 'read_only',
          },
          overrideAccess: true,
        })
        affectedClusters++
      }
    }

    // Trigger decommissioning workflow to set up cleanup schedule
    const workflowId = await triggerDecommissioningWorkflow(input.applicationId, {
      applicationId: input.applicationId,
      workspaceId: accessCheck.workspaceId!,
      gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
      forceDelete: false,
      reason: input.reason,
    })

    // If workflow failed to start, rollback the decommissioning
    if (!workflowId) {
      // Restore application status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await payload.update({
        collection: 'kafka-applications',
        id: input.applicationId,
        data: {
          status: 'active',
          decommissioningStartedAt: null,
          gracePeriodEndsAt: null,
          gracePeriodDaysOverride: null,
          decommissionReason: null,
        } as any,
        overrideAccess: true,
      })

      // Restore virtual clusters to active
      for (const vc of virtualClusters.docs) {
        if (vc.status === 'active') {
          // These were set to read_only above, restore them
          await payload.update({
            collection: 'kafka-virtual-clusters',
            id: vc.id,
            data: { status: 'active' },
            overrideAccess: true,
          })
        }
      }

      return {
        success: false,
        error: 'Failed to start decommissioning workflow. Please try again.',
      }
    }

    // Store workflow ID on application for tracking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await payload.update({
      collection: 'kafka-applications',
      id: input.applicationId,
      data: {
        decommissionWorkflowId: workflowId,
      } as any,
      overrideAccess: true,
    })

    return {
      success: true,
      gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
      affectedVirtualClusters: affectedClusters,
    }
  } catch (error) {
    console.error('Error decommissioning application:', error)
    return { success: false, error: 'Failed to decommission application' }
  }
}

/**
 * Cancel decommissioning and restore the application to active status.
 *
 * This action:
 * 1. Sets the application status back to 'active'
 * 2. Clears decommissioning-related fields
 * 3. Restores all virtual clusters to 'active' mode
 * 4. Cancels any scheduled cleanup workflows
 *
 * @param applicationId - The application ID to restore
 * @returns Result with restoration information
 */
export async function cancelDecommissioning(
  applicationId: string
): Promise<CancelDecommissioningResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify admin access
    const accessCheck = await verifyWorkspaceAdminAccess(
      payload,
      session.user.id,
      applicationId
    )

    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    // Get current application state
    const app = (await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      overrideAccess: true,
    })) as KafkaApplicationWithLifecycle | null

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    if (app.status !== 'decommissioning') {
      return { success: false, error: 'Application is not being decommissioned' }
    }

    // Check if grace period has expired
    if (app.gracePeriodEndsAt) {
      const endsAt = new Date(app.gracePeriodEndsAt)
      if (new Date() >= endsAt) {
        return {
          success: false,
          error: 'Grace period has expired. Cannot cancel decommissioning.',
        }
      }
    }

    // Get all virtual clusters for this application
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { equals: applicationId },
        status: { equals: 'read_only' },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Restore virtual clusters to active
    let restoredClusters = 0
    for (const vc of virtualClusters.docs) {
      await payload.update({
        collection: 'kafka-virtual-clusters',
        id: vc.id,
        data: {
          status: 'active',
        },
        overrideAccess: true,
      })
      restoredClusters++
    }

    // Update application status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lifecycle fields exist in collection but may not be in generated types yet
    await payload.update({
      collection: 'kafka-applications',
      id: applicationId,
      data: {
        status: 'active',
        decommissioningStartedAt: null,
        gracePeriodEndsAt: null,
        gracePeriodDaysOverride: null,
        decommissionReason: null,
        cleanupWorkflowId: null,
      } as any,
      overrideAccess: true,
    })

    // Cancel the scheduled cleanup workflow if one exists
    if (app.cleanupWorkflowId) {
      await cancelCleanupSchedule(applicationId)
    }

    return {
      success: true,
      restoredVirtualClusters: restoredClusters,
    }
  } catch (error) {
    console.error('Error canceling decommissioning:', error)
    return { success: false, error: 'Failed to cancel decommissioning' }
  }
}

/**
 * Force delete an application immediately, bypassing the grace period.
 *
 * This action:
 * 1. Deletes all topics associated with the application
 * 2. Deletes all virtual clusters
 * 3. Marks the application as deleted
 * 4. Records who performed the force delete and why
 *
 * WARNING: This is a destructive operation that cannot be undone.
 *
 * @param applicationId - The application ID to delete
 * @param reason - Optional reason for the force delete
 * @returns Result with deletion information
 */
export async function forceDeleteApplication(
  applicationId: string,
  reason?: string
): Promise<ForceDeleteApplicationResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify admin access
    const accessCheck = await verifyWorkspaceAdminAccess(
      payload,
      session.user.id,
      applicationId
    )

    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    // Get current application state
    const app = (await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      overrideAccess: true,
    })) as KafkaApplicationWithLifecycle | null

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    if (app.status === 'deleted') {
      return { success: false, error: 'Application is already deleted' }
    }

    // Get all virtual clusters for this application
    const virtualClusters = await payload.find({
      collection: 'kafka-virtual-clusters',
      where: {
        application: { equals: applicationId },
        status: { not_equals: 'deleted' },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Get all topics for this application's virtual clusters
    const vcIds = virtualClusters.docs.map((vc) => vc.id)
    const topics = await payload.find({
      collection: 'kafka-topics',
      where: {
        virtualCluster: { in: vcIds },
        status: { not_equals: 'deleted' },
      },
      limit: 1000,
      overrideAccess: true,
    })

    // Cancel any existing cleanup schedule first (if application was already decommissioning)
    const scheduleCanceled = await cancelCleanupSchedule(applicationId)
    if (!scheduleCanceled && app.cleanupWorkflowId) {
      console.warn(
        `[Kafka] Failed to cancel cleanup schedule for application ${applicationId}. ` +
          'Manual cleanup may still occur at scheduled time.'
      )
    }

    // Trigger immediate cleanup workflow BEFORE marking anything as deleted
    // This ensures the workflow can clean up physical resources
    const workflowId = await triggerDecommissioningWorkflow(applicationId, {
      applicationId: applicationId,
      workspaceId: accessCheck.workspaceId!,
      gracePeriodEndsAt: new Date().toISOString(), // Immediate
      forceDelete: true,
      reason: reason || app.decommissionReason || 'Force deleted',
    })

    if (!workflowId) {
      return {
        success: false,
        error: 'Failed to start force delete workflow. Physical resources were not cleaned up.',
      }
    }

    // Now mark all topics as deleted in the database
    let deletedTopics = 0
    for (const topic of topics.docs) {
      await payload.update({
        collection: 'kafka-topics',
        id: topic.id,
        data: {
          status: 'deleted',
        },
        overrideAccess: true,
      })
      deletedTopics++
    }

    // Mark all virtual clusters as deleted
    let deletedVirtualClusters = 0
    for (const vc of virtualClusters.docs) {
      await payload.update({
        collection: 'kafka-virtual-clusters',
        id: vc.id,
        data: {
          status: 'deleted',
        },
        overrideAccess: true,
      })
      deletedVirtualClusters++
    }

    // Mark application as deleted with workflow ID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lifecycle fields exist in collection but may not be in generated types yet
    await payload.update({
      collection: 'kafka-applications',
      id: applicationId,
      data: {
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        deletedBy: session.user.id,
        forceDeleted: true,
        decommissionReason: reason || app.decommissionReason,
        decommissionWorkflowId: workflowId,
      } as any,
      overrideAccess: true,
    })

    return {
      success: true,
      deletedTopics,
      deletedVirtualClusters,
    }
  } catch (error) {
    console.error('Error force deleting application:', error)
    return { success: false, error: 'Failed to force delete application' }
  }
}

/**
 * Get the current lifecycle status of an application.
 *
 * Returns detailed information about the application's lifecycle state,
 * including grace period status and available actions.
 *
 * @param applicationId - The application ID to check
 * @returns Lifecycle status information
 */
export async function getApplicationLifecycleStatus(
  applicationId: string
): Promise<ApplicationLifecycleStatusResult> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Fetch the application
    const app = (await payload.findByID({
      collection: 'kafka-applications',
      id: applicationId,
      overrideAccess: true,
    })) as KafkaApplicationWithLifecycle | null

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    // Verify user has access to view this application
    const workspaceId =
      typeof app.workspace === 'string' ? app.workspace : app.workspace.id

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

    // Calculate lifecycle state
    const lifecycle = calculateLifecycleState(
      app.status,
      app.decommissioningStartedAt,
      app.gracePeriodEndsAt
    )

    return {
      success: true,
      lifecycle,
      applicationName: app.name,
      applicationSlug: app.slug,
    }
  } catch (error) {
    console.error('Error getting application lifecycle status:', error)
    return { success: false, error: 'Failed to get lifecycle status' }
  }
}
