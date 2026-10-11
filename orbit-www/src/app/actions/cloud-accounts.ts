'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, type Actor } from '@/lib/authz'
import {
  mergeCredentialUpdate,
  publicCloudAccount,
  revealCloudCredentials,
} from '@/lib/cloud-accounts/credentials'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudAccountDoc {
  id: string
  name: string
  provider: 'azure' | 'digitalocean'
  credentials: Record<string, unknown>
  region?: string
  workspaces: Array<string | { id: string; name: string; slug: string }>
  status: 'connected' | 'disconnected' | 'error'
  lastValidatedAt?: string
  approvalRequired: boolean
  approvers?: Array<string | { id: string; name: string; email: string }>
  createdBy?: string | { id: string; name: string; email: string }
  createdAt: string
  updatedAt: string
}

export interface WorkspaceOption {
  id: string
  name: string
  slug: string
}

export interface UserOption {
  id: string
  name: string
  email: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAdmin(): Promise<
  { authorized: false; error: string } | { authorized: true; actor: Actor }
> {
  const actor = await getActor()
  if (!actor) {
    return { authorized: false, error: 'Unauthorized' }
  }
  if (!actor.isPlatformAdmin) {
    return { authorized: false, error: 'Forbidden: admin access required' }
  }
  return { authorized: true, actor }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Get all cloud accounts (admin only).
 */
export async function getAllCloudAccounts(): Promise<{
  accounts: CloudAccountDoc[]
  workspaces: WorkspaceOption[]
  users: UserOption[]
  error?: string
}> {
  const check = await requireAdmin()
  if (!check.authorized) {
    return { accounts: [], workspaces: [], users: [], error: check.error }
  }

  const payload = await getPayload({ config })

  try {
    const [accountsResult, workspacesResult, usersResult] = await Promise.all([
      payload.find({
        collection: 'cloud-accounts',
        limit: 500,
        depth: 1,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'workspaces',
        limit: 500,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'users',
        limit: 500,
        depth: 0,
      }),
    ])

    return {
      // Credentials are encrypted at rest; only non-secret identifiers (tenant /
      // client id) are projected for the browser, never secrets or ciphertext.
      accounts: accountsResult.docs.map((d) => publicCloudAccount(d)) as unknown as CloudAccountDoc[],
      workspaces: workspacesResult.docs.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
      })),
      users: usersResult.docs.map((u: any) => ({
        id: u.id,
        name: u.name || u.email,
        email: u.email,
      })),
    }
  } catch (error) {
    console.error('Failed to fetch cloud accounts:', error)
    return { accounts: [], workspaces: [], users: [], error: 'Failed to fetch data' }
  }
}

/**
 * Create a new cloud account (admin only).
 */
export async function createCloudAccount(data: {
  name: string
  provider: 'azure' | 'digitalocean'
  credentials: Record<string, unknown>
  region?: string
  workspaces: string[]
  approvalRequired: boolean
  approvers?: string[]
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const check = await requireAdmin()
  if (!check.authorized) {
    return { success: false, error: check.error }
  }

  const payload = await getPayload({ config })

  try {
    const doc = await payload.create({
      collection: 'cloud-accounts',
      data: {
        name: data.name,
        provider: data.provider,
        credentials: data.credentials,
        region: data.region || undefined,
        workspaces: data.workspaces,
        approvalRequired: data.approvalRequired,
        approvers: data.approvers || [],
        createdBy: check.actor.payloadId,
        status: 'disconnected',
      } as any,
      user: check.actor.user,
      overrideAccess: false,
    })

    return { success: true, id: doc.id }
  } catch (error) {
    console.error('Failed to create cloud account:', error)
    return { success: false, error: 'Failed to create cloud account' }
  }
}

/**
 * Update an existing cloud account (admin only).
 */
export async function updateCloudAccount(
  id: string,
  data: {
    name?: string
    provider?: 'azure' | 'digitalocean'
    credentials?: Record<string, unknown>
    region?: string
    workspaces?: string[]
    approvalRequired?: boolean
    approvers?: string[]
  },
): Promise<{ success: boolean; error?: string }> {
  const check = await requireAdmin()
  if (!check.authorized) {
    return { success: false, error: check.error }
  }

  const payload = await getPayload({ config })

  try {
    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.provider !== undefined) updateData.provider = data.provider
    if (data.credentials !== undefined) {
      // Blank values mean "keep the stored value" so editing non-secret fields
      // (tenant/client id) never wipes the stored secret.
      const existing = await payload.findByID({
        collection: 'cloud-accounts',
        id,
        depth: 0,
        overrideAccess: true,
      })
      updateData.credentials = mergeCredentialUpdate(
        revealCloudCredentials(existing.credentials),
        data.credentials,
      )
    }
    if (data.region !== undefined) updateData.region = data.region
    if (data.workspaces !== undefined) updateData.workspaces = data.workspaces
    if (data.approvalRequired !== undefined) updateData.approvalRequired = data.approvalRequired
    if (data.approvers !== undefined) updateData.approvers = data.approvers

    await payload.update({
      collection: 'cloud-accounts',
      id,
      data: updateData as any,
      user: check.actor.user,
      overrideAccess: false,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to update cloud account:', error)
    return { success: false, error: 'Failed to update cloud account' }
  }
}

/**
 * Delete a cloud account (admin only).
 */
export async function deleteCloudAccount(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const check = await requireAdmin()
  if (!check.authorized) {
    return { success: false, error: check.error }
  }

  const payload = await getPayload({ config })

  try {
    await payload.delete({
      collection: 'cloud-accounts',
      id,
      user: check.actor.user,
      overrideAccess: false,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete cloud account:', error)
    return { success: false, error: 'Failed to delete cloud account' }
  }
}

/**
 * Test a cloud account connection (admin only).
 * Stub: validates credentials are non-empty, updates status to 'connected'.
 */
export async function testCloudAccountConnection(
  id: string,
): Promise<{ success: boolean; valid: boolean; error?: string }> {
  const check = await requireAdmin()
  if (!check.authorized) {
    return { success: false, valid: false, error: check.error }
  }

  const payload = await getPayload({ config })

  try {
    const account = await payload.findByID({
      collection: 'cloud-accounts',
      id,
      overrideAccess: true,
    })

    if (!account) {
      return { success: false, valid: false, error: 'Cloud account not found' }
    }

    // Stub validation: check that credentials object is non-empty. Credentials
    // are encrypted at rest; an unreadable value counts as incomplete.
    let creds: Record<string, unknown> | null = null
    try {
      creds = revealCloudCredentials(account.credentials)
    } catch {
      creds = null
    }
    const hasCredentials =
      creds != null &&
      typeof creds === 'object' &&
      Object.keys(creds).length > 0 &&
      Object.values(creds).every((v) => v !== '' && v !== null && v !== undefined)

    if (!hasCredentials) {
      await payload.update({
        collection: 'cloud-accounts',
        id,
        data: { status: 'error' } as any,
        overrideAccess: true,
      })
      return { success: true, valid: false, error: 'Credentials are empty or incomplete' }
    }

    await payload.update({
      collection: 'cloud-accounts',
      id,
      data: {
        status: 'connected',
        lastValidatedAt: new Date().toISOString(),
      } as any,
      overrideAccess: true,
    })

    return { success: true, valid: true }
  } catch (error) {
    console.error('Failed to test cloud account connection:', error)
    return { success: false, valid: false, error: 'Failed to test connection' }
  }
}
