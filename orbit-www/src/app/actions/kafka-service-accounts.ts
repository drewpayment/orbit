'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTemporalClient } from '@/lib/temporal/client'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import type { KafkaServiceAccount } from '@/payload-types'
import {
  generateSecurePassword,
  hashPassword,
  generateServiceAccountUsername,
} from '@/collections/kafka/KafkaServiceAccounts'

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Workflow input type matching Go CredentialUpsertWorkflowInput struct.
 * Field names use camelCase to match Go JSON tags.
 */
type CredentialUpsertWorkflowInput = {
  credentialId: string
  virtualClusterId: string
  username: string
  passwordHash: string
  template: string
}

/**
 * Workflow input type matching Go CredentialRevokeWorkflowInput struct.
 */
type CredentialRevokeWorkflowInput = {
  credentialId: string
}

// ============================================================================
// Workflow Helper Functions
// ============================================================================

/**
 * Trigger the CredentialUpsertWorkflow to sync a credential to Bifrost.
 * Uses a deterministic workflow ID based on service account ID for idempotency.
 * If a workflow is already running for this credential, Temporal will reject the duplicate.
 *
 * @param serviceAccountId - Service account ID (used for workflow ID)
 * @param input - Workflow input matching Go struct
 * @returns Workflow ID if started successfully, null otherwise
 */
async function triggerCredentialUpsertWorkflow(
  serviceAccountId: string,
  input: CredentialUpsertWorkflowInput
): Promise<string | null> {
  // Use deterministic ID for idempotency - only one sync can run at a time per credential
  const workflowId = `credential-upsert-${serviceAccountId}`

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('CredentialUpsertWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [input],
    })

    console.log(
      `[Kafka] Started CredentialUpsertWorkflow: ${handle.workflowId} for service account ${serviceAccountId}`
    )

    return handle.workflowId
  } catch (error) {
    // Check if workflow is already running using Temporal's specific error type
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      console.log(
        `[Kafka] CredentialUpsertWorkflow already running for service account ${serviceAccountId}`
      )
      return workflowId // Return the existing workflow ID
    }
    console.error('[Kafka] Failed to start CredentialUpsertWorkflow:', error)
    return null
  }
}

/**
 * Trigger the CredentialRevokeWorkflow to revoke a credential from Bifrost.
 * Uses a deterministic workflow ID based on service account ID for idempotency.
 *
 * @param serviceAccountId - Service account ID (used for workflow ID)
 * @param input - Workflow input matching Go struct
 * @returns Workflow ID if started successfully, null otherwise
 */
async function triggerCredentialRevokeWorkflow(
  serviceAccountId: string,
  input: CredentialRevokeWorkflowInput
): Promise<string | null> {
  // Use deterministic ID - revoke should be idempotent
  const workflowId = `credential-revoke-${serviceAccountId}`

  try {
    const client = await getTemporalClient()

    const handle = await client.workflow.start('CredentialRevokeWorkflow', {
      taskQueue: 'orbit-workflows',
      workflowId,
      args: [input],
    })

    console.log(
      `[Kafka] Started CredentialRevokeWorkflow: ${handle.workflowId} for service account ${serviceAccountId}`
    )

    return handle.workflowId
  } catch (error) {
    // Check if workflow is already running using Temporal's specific error type
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      console.log(
        `[Kafka] CredentialRevokeWorkflow already running for service account ${serviceAccountId}`
      )
      return workflowId // Return the existing workflow ID
    }
    console.error('[Kafka] Failed to start CredentialRevokeWorkflow:', error)
    return null
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify that the current user has admin/owner access to the service account's workspace.
 */
async function verifyServiceAccountAccess(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  serviceAccountId: string
): Promise<{
  allowed: boolean
  error?: string
  serviceAccount?: KafkaServiceAccount
  virtualClusterId?: string
}> {
  // Get the service account with depth to get application/workspace
  const serviceAccount = await payload.findByID({
    collection: 'kafka-service-accounts',
    id: serviceAccountId,
    depth: 2,
    overrideAccess: true,
  })

  if (!serviceAccount) {
    return { allowed: false, error: 'Service account not found' }
  }

  // Get application from service account
  const app =
    typeof serviceAccount.application === 'string'
      ? await payload.findByID({
          collection: 'kafka-applications',
          id: serviceAccount.application,
          overrideAccess: true,
        })
      : serviceAccount.application

  if (!app) {
    return { allowed: false, error: 'Application not found' }
  }

  const workspaceId = typeof app.workspace === 'string' ? app.workspace : app.workspace.id

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
    return { allowed: false, error: 'Insufficient permissions' }
  }

  // Get virtual cluster ID
  const virtualClusterId =
    typeof serviceAccount.virtualCluster === 'string'
      ? serviceAccount.virtualCluster
      : serviceAccount.virtualCluster?.id

  return { allowed: true, serviceAccount, virtualClusterId }
}

// ============================================================================
// Types
// ============================================================================

export interface CreateServiceAccountInput {
  name: string
  applicationId: string
  virtualClusterId: string
  permissionTemplate: 'producer' | 'consumer' | 'admin' | 'custom'
  customPermissions?: {
    resourceType: 'topic' | 'group' | 'transactional_id'
    resourcePattern: string
    operations: ('create' | 'delete' | 'read' | 'write' | 'alter' | 'describe')[]
  }[]
}

export interface CreateServiceAccountResult {
  success: boolean
  serviceAccountId?: string
  username?: string
  password?: string // Only returned on create, not stored in plain text
  error?: string
}

export async function createServiceAccount(
  input: CreateServiceAccountInput
): Promise<CreateServiceAccountResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Get virtual cluster to determine workspace/app/env
    const virtualCluster = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id: input.virtualClusterId,
      depth: 2,
      overrideAccess: true,
    })

    if (!virtualCluster) {
      return { success: false, error: 'Virtual cluster not found' }
    }

    // Validate virtual cluster status - only allow service account creation for active clusters
    if (virtualCluster.status !== 'active') {
      const statusMessages: Record<string, string> = {
        provisioning: 'Virtual cluster is still provisioning. Please wait for it to become active.',
        read_only: 'Virtual cluster is in read-only mode. Cannot create new service accounts.',
        deleting: 'Virtual cluster is being deleted. Cannot create new service accounts.',
        deleted: 'Virtual cluster has been deleted.',
      }
      return {
        success: false,
        error: statusMessages[virtualCluster.status] || 'Virtual cluster is not active',
      }
    }

    const app =
      typeof virtualCluster.application === 'string'
        ? await payload.findByID({
            collection: 'kafka-applications',
            id: virtualCluster.application,
            overrideAccess: true,
          })
        : virtualCluster.application

    if (!app) {
      return { success: false, error: 'Application not found' }
    }

    const workspace =
      typeof app.workspace === 'string'
        ? await payload.findByID({
            collection: 'workspaces',
            id: app.workspace,
            overrideAccess: true,
          })
        : app.workspace

    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    // Verify user is member of workspace with admin/owner role
    const membership = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { workspace: { equals: workspace.id } },
          { user: { equals: session.user.id } },
          { role: { in: ['owner', 'admin'] } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })

    if (membership.docs.length === 0) {
      return { success: false, error: 'Insufficient permissions' }
    }

    // Generate username and password
    const username = generateServiceAccountUsername(
      workspace.slug,
      app.slug,
      virtualCluster.environment,
      input.name
    )
    const password = generateSecurePassword()
    const passwordHashValue = hashPassword(password)

    // Check if username already exists
    const existing = await payload.find({
      collection: 'kafka-service-accounts',
      where: { username: { equals: username } },
      limit: 1,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      return { success: false, error: 'A service account with this name already exists' }
    }

    // Create service account
    const serviceAccount = await payload.create({
      collection: 'kafka-service-accounts',
      data: {
        name: input.name,
        application: app.id,
        virtualCluster: input.virtualClusterId,
        username,
        passwordHash: passwordHashValue,
        permissionTemplate: input.permissionTemplate,
        customPermissions: input.customPermissions || [],
        status: 'active',
        createdBy: session.user.id,
      },
      overrideAccess: true,
    })

    // Trigger workflow to sync credential to Bifrost
    const workflowId = await triggerCredentialUpsertWorkflow(serviceAccount.id, {
      credentialId: serviceAccount.id,
      virtualClusterId: input.virtualClusterId,
      username,
      passwordHash: passwordHashValue,
      template: input.permissionTemplate,
    })

    if (!workflowId) {
      // Rollback: delete the service account since Bifrost sync failed
      // This ensures consistency - credential only exists if synced to Bifrost
      try {
        await payload.delete({
          collection: 'kafka-service-accounts',
          id: serviceAccount.id,
          overrideAccess: true,
        })
      } catch (rollbackError) {
        // CRITICAL: Rollback failed - orphaned service account in database
        console.error(
          `[Kafka] CRITICAL: Failed to rollback service account ${serviceAccount.id}. ` +
            'Orphaned record may exist.',
          rollbackError
        )
        return {
          success: false,
          error:
            'Failed to sync credential to Bifrost and cleanup failed. Please contact support.',
        }
      }
      return {
        success: false,
        error: 'Failed to sync credential to Bifrost. Service account was not created.',
      }
    }

    return {
      success: true,
      serviceAccountId: serviceAccount.id,
      username,
      password, // Return plain password only on create
    }
  } catch (error) {
    console.error('Error creating service account:', error)
    return { success: false, error: 'Failed to create service account' }
  }
}

export interface RotateServiceAccountResult {
  success: boolean
  password?: string
  error?: string
}

export async function rotateServiceAccountPassword(
  serviceAccountId: string
): Promise<RotateServiceAccountResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify workspace admin access
    const accessCheck = await verifyServiceAccountAccess(payload, session.user.id, serviceAccountId)
    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    const serviceAccount = accessCheck.serviceAccount
    if (!serviceAccount) {
      return { success: false, error: 'Service account not found' }
    }

    if (serviceAccount.status === 'revoked') {
      return { success: false, error: 'Cannot rotate revoked service account' }
    }

    // Rate limiting: enforce minimum 5 minutes between rotations
    if (serviceAccount.lastRotatedAt) {
      const lastRotated = new Date(serviceAccount.lastRotatedAt)
      const cooldownMs = 5 * 60 * 1000 // 5 minutes
      const timeSinceLastRotation = Date.now() - lastRotated.getTime()

      if (timeSinceLastRotation < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastRotation) / 1000)
        return {
          success: false,
          error: `Please wait ${remainingSeconds} seconds before rotating again.`,
        }
      }
    }

    // Store original password hash for potential rollback
    const originalPasswordHash = serviceAccount.passwordHash
    const originalLastRotatedAt = serviceAccount.lastRotatedAt

    // Generate new password
    const password = generateSecurePassword()
    const passwordHashValue = hashPassword(password)

    // Update service account
    await payload.update({
      collection: 'kafka-service-accounts',
      id: serviceAccountId,
      data: {
        passwordHash: passwordHashValue,
        lastRotatedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    // Trigger workflow to sync updated credential to Bifrost
    if (accessCheck.virtualClusterId) {
      const workflowId = await triggerCredentialUpsertWorkflow(serviceAccountId, {
        credentialId: serviceAccountId,
        virtualClusterId: accessCheck.virtualClusterId,
        username: serviceAccount.username,
        passwordHash: passwordHashValue,
        template: serviceAccount.permissionTemplate,
      })

      if (!workflowId) {
        // Rollback: restore original password hash since Bifrost sync failed
        try {
          await payload.update({
            collection: 'kafka-service-accounts',
            id: serviceAccountId,
            data: {
              passwordHash: originalPasswordHash,
              lastRotatedAt: originalLastRotatedAt,
            },
            overrideAccess: true,
          })
        } catch (rollbackError) {
          // CRITICAL: Rollback failed - system is in inconsistent state
          console.error(
            `[Kafka] CRITICAL: Failed to rollback password for service account ${serviceAccountId}. ` +
              'Manual intervention required.',
            rollbackError
          )
          return {
            success: false,
            error:
              'Password rotation failed and rollback failed. Please contact support immediately.',
          }
        }
        return {
          success: false,
          error: 'Failed to sync credential to Bifrost. Password was not rotated.',
        }
      }
    }

    return {
      success: true,
      password, // Return new plain password
    }
  } catch (error) {
    console.error('Error rotating service account password:', error)
    return { success: false, error: 'Failed to rotate password' }
  }
}

export interface RevokeServiceAccountResult {
  success: boolean
  error?: string
}

export async function revokeServiceAccount(
  serviceAccountId: string
): Promise<RevokeServiceAccountResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    // Verify workspace admin access
    const accessCheck = await verifyServiceAccountAccess(payload, session.user.id, serviceAccountId)
    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.error }
    }

    const serviceAccount = accessCheck.serviceAccount
    if (!serviceAccount) {
      return { success: false, error: 'Service account not found' }
    }

    // Don't revoke if already revoked
    if (serviceAccount.status === 'revoked') {
      return { success: false, error: 'Service account is already revoked' }
    }

    // Update status to revoked
    await payload.update({
      collection: 'kafka-service-accounts',
      id: serviceAccountId,
      data: {
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy: session.user.id,
      },
      overrideAccess: true,
    })

    // Trigger workflow to revoke credential from Bifrost
    const workflowId = await triggerCredentialRevokeWorkflow(serviceAccountId, {
      credentialId: serviceAccountId,
    })

    if (!workflowId) {
      console.warn(
        `[Kafka] Service account ${serviceAccountId} revoked in database but Bifrost revoke failed. ` +
          'Manual revocation may be required.'
      )
    }

    return { success: true }
  } catch (error) {
    console.error('Error revoking service account:', error)
    return { success: false, error: 'Failed to revoke service account' }
  }
}

export interface ListServiceAccountsInput {
  virtualClusterId: string
}

export interface ServiceAccountData {
  id: string
  name: string
  username: string
  permissionTemplate: string
  status: 'active' | 'revoked'
  createdAt: string
  lastRotatedAt?: string
}

export interface ListServiceAccountsResult {
  success: boolean
  serviceAccounts?: ServiceAccountData[]
  error?: string
}

export async function listServiceAccounts(
  input: ListServiceAccountsInput
): Promise<ListServiceAccountsResult> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await getPayload({ config })

    const accounts = await payload.find({
      collection: 'kafka-service-accounts',
      where: {
        virtualCluster: { equals: input.virtualClusterId },
      },
      sort: '-createdAt',
      limit: 100,
    })

    const serviceAccounts: ServiceAccountData[] = accounts.docs.map((acc) => ({
      id: acc.id,
      name: acc.name,
      username: acc.username,
      permissionTemplate: acc.permissionTemplate,
      status: acc.status as 'active' | 'revoked',
      createdAt: acc.createdAt,
      lastRotatedAt: acc.lastRotatedAt || undefined,
    }))

    return { success: true, serviceAccounts }
  } catch (error) {
    console.error('Error listing service accounts:', error)
    return { success: false, error: 'Failed to list service accounts' }
  }
}
