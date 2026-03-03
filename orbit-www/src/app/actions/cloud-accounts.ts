'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloudAccountDoc {
  id: string
  name: string
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean'
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

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return { authorized: false as const, error: 'Unauthorized' }
  }
  const role = (session.user as any).role
  if (role !== 'super_admin' && role !== 'admin') {
    return { authorized: false as const, error: 'Forbidden: admin access required' }
  }
  return { authorized: true as const, userId: session.user.id }
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
      }),
      payload.find({
        collection: 'users',
        limit: 500,
        depth: 0,
      }),
    ])

    return {
      accounts: accountsResult.docs as unknown as CloudAccountDoc[],
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
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean'
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
        createdBy: check.userId,
        status: 'disconnected',
      } as any,
      overrideAccess: true,
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
    provider?: 'aws' | 'gcp' | 'azure' | 'digitalocean'
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
    if (data.credentials !== undefined) updateData.credentials = data.credentials
    if (data.region !== undefined) updateData.region = data.region
    if (data.workspaces !== undefined) updateData.workspaces = data.workspaces
    if (data.approvalRequired !== undefined) updateData.approvalRequired = data.approvalRequired
    if (data.approvers !== undefined) updateData.approvers = data.approvers

    await payload.update({
      collection: 'cloud-accounts',
      id,
      data: updateData as any,
      overrideAccess: true,
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
      overrideAccess: true,
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

    // Stub validation: check that credentials object is non-empty
    const creds = account.credentials as Record<string, unknown> | null
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
