'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTemporalClient } from '@/lib/temporal/client'
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
 *
 * @param serviceAccountId - Service account ID (used for workflow ID)
 * @param input - Workflow input matching Go struct
 * @returns Workflow ID if started successfully, null otherwise
 */
async function triggerCredentialUpsertWorkflow(
  serviceAccountId: string,
  input: CredentialUpsertWorkflowInput
): Promise<string | null> {
  const workflowId = `credential-upsert-${serviceAccountId}-${Date.now()}`

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
    console.error('[Kafka] Failed to start CredentialUpsertWorkflow:', error)
    return null
  }
}

/**
 * Trigger the CredentialRevokeWorkflow to revoke a credential from Bifrost.
 *
 * @param serviceAccountId - Service account ID (used for workflow ID)
 * @param input - Workflow input matching Go struct
 * @returns Workflow ID if started successfully, null otherwise
 */
async function triggerCredentialRevokeWorkflow(
  serviceAccountId: string,
  input: CredentialRevokeWorkflowInput
): Promise<string | null> {
  const workflowId = `credential-revoke-${serviceAccountId}-${Date.now()}`

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
    console.error('[Kafka] Failed to start CredentialRevokeWorkflow:', error)
    return null
  }
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
    resourceType: string
    resourcePattern: string
    operations: string[]
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
      // Credential created but sync failed - mark as pending sync
      console.warn(
        `[Kafka] Service account ${serviceAccount.id} created but Bifrost sync failed. ` +
          'Manual sync may be required.'
      )
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

    // Get service account and verify permissions
    const serviceAccount = await payload.findByID({
      collection: 'kafka-service-accounts',
      id: serviceAccountId,
      depth: 2,
      overrideAccess: true,
    })

    if (!serviceAccount) {
      return { success: false, error: 'Service account not found' }
    }

    if (serviceAccount.status === 'revoked') {
      return { success: false, error: 'Cannot rotate revoked service account' }
    }

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

    // Get virtual cluster ID for workflow
    const virtualClusterId =
      typeof serviceAccount.virtualCluster === 'string'
        ? serviceAccount.virtualCluster
        : serviceAccount.virtualCluster?.id

    // Trigger workflow to sync updated credential to Bifrost
    if (virtualClusterId) {
      const workflowId = await triggerCredentialUpsertWorkflow(serviceAccountId, {
        credentialId: serviceAccountId,
        virtualClusterId,
        username: serviceAccount.username,
        passwordHash: passwordHashValue,
        template: serviceAccount.permissionTemplate,
      })

      if (!workflowId) {
        console.warn(
          `[Kafka] Service account ${serviceAccountId} password rotated but Bifrost sync failed. ` +
            'Manual sync may be required.'
        )
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
