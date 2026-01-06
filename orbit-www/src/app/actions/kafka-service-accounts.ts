'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import {
  generateSecurePassword,
  hashPassword,
  generateServiceAccountUsername,
} from '@/collections/kafka/KafkaServiceAccounts'

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

    // TODO: Trigger Temporal workflow to sync credential to Bifrost

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

    // TODO: Trigger Temporal workflow to sync new credential to Bifrost

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

    // TODO: Trigger Temporal workflow to revoke credential from Bifrost

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
