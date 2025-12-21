'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { decrypt } from '@/lib/encryption'

export interface RegistryConfig {
  id: string
  name: string
  type: 'ghcr' | 'acr' | 'orbit'
  isDefault: boolean
  workspace: { id: string; name: string; slug: string }
  ghcrOwner?: string
  ghcrValidationStatus?: 'pending' | 'valid' | 'invalid'
  ghcrValidatedAt?: string
  acrLoginServer?: string
  acrUsername?: string
  acrValidationStatus?: 'pending' | 'valid' | 'invalid'
  acrValidatedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
}

/**
 * Get all registries and workspaces for the current user
 */
export async function getRegistriesAndWorkspaces(): Promise<{
  registries: RegistryConfig[]
  workspaces: Workspace[]
  error?: string
}> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { registries: [], workspaces: [], error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    // Get user's workspace memberships
    const memberships = await payload.find({
      collection: 'workspace-members',
      where: {
        and: [
          { user: { equals: session.user.id } },
          { status: { equals: 'active' } },
        ],
      },
      depth: 1,
      limit: 100,
    })

    const workspaceIds = memberships.docs.map((m) =>
      typeof m.workspace === 'string' ? m.workspace : m.workspace.id
    )

    // Get workspaces where user is admin/owner (for creating registries)
    const adminMemberships = memberships.docs.filter((m) =>
      ['owner', 'admin'].includes(m.role)
    )
    const adminWorkspaceIds = adminMemberships.map((m) =>
      typeof m.workspace === 'string' ? m.workspace : m.workspace.id
    )

    // Fetch workspaces
    const workspacesResult = adminWorkspaceIds.length > 0
      ? await payload.find({
          collection: 'workspaces',
          where: {
            id: { in: adminWorkspaceIds },
          },
          limit: 100,
        })
      : { docs: [] }

    // Fetch registries for user's workspaces
    const registriesResult = workspaceIds.length > 0
      ? await payload.find({
          collection: 'registry-configs',
          where: {
            workspace: { in: workspaceIds },
          },
          depth: 1,
          limit: 100,
        })
      : { docs: [] }

    return {
      registries: registriesResult.docs as unknown as RegistryConfig[],
      workspaces: workspacesResult.docs.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
      })),
    }
  } catch (error) {
    console.error('Failed to fetch registries:', error)
    return { registries: [], workspaces: [], error: 'Failed to fetch data' }
  }
}

/**
 * Create a new registry config
 */
export async function createRegistry(data: {
  name: string
  type: 'ghcr' | 'acr' | 'orbit'
  workspace: string
  isDefault?: boolean
  ghcrOwner?: string
  ghcrPat?: string
  acrLoginServer?: string
  acrUsername?: string
  acrToken?: string
}): Promise<{ success: boolean; registry?: RegistryConfig; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Verify user is admin/owner of the workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: data.workspace } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not authorized for this workspace' }
  }

  try {
    const registryData: Record<string, unknown> = {
      name: data.name,
      type: data.type,
      workspace: data.workspace,
      isDefault: data.isDefault || false,
    }

    if (data.type === 'ghcr') {
      registryData.ghcrOwner = data.ghcrOwner
      if (data.ghcrPat) {
        registryData.ghcrPat = data.ghcrPat // Will be encrypted by beforeChange hook
      }
    } else if (data.type === 'acr') {
      registryData.acrLoginServer = data.acrLoginServer
      registryData.acrUsername = data.acrUsername
      if (data.acrToken) {
        registryData.acrToken = data.acrToken
      }
    }

    const registry = await payload.create({
      collection: 'registry-configs',
      data: registryData as any,
    })

    return { success: true, registry: registry as unknown as RegistryConfig }
  } catch (error) {
    console.error('Failed to create registry:', error)
    return { success: false, error: 'Failed to create registry' }
  }
}

/**
 * Update a registry config
 */
export async function updateRegistry(
  id: string,
  data: {
    name?: string
    isDefault?: boolean
    ghcrOwner?: string
    ghcrPat?: string
    acrLoginServer?: string
    acrUsername?: string
    acrToken?: string
  }
): Promise<{ success: boolean; registry?: RegistryConfig; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get the registry to find its workspace
  const existingRegistry = await payload.findByID({
    collection: 'registry-configs',
    id,
  })

  if (!existingRegistry) {
    return { success: false, error: 'Registry not found' }
  }

  const workspaceId = typeof existingRegistry.workspace === 'string'
    ? existingRegistry.workspace
    : existingRegistry.workspace.id

  // Verify user is admin/owner of the workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not authorized for this workspace' }
  }

  try {
    const updateData: Record<string, unknown> = {}

    if (data.name !== undefined) updateData.name = data.name
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault
    if (data.ghcrOwner !== undefined) updateData.ghcrOwner = data.ghcrOwner
    if (data.ghcrPat) updateData.ghcrPat = data.ghcrPat // Will be encrypted by beforeChange hook
    if (data.acrLoginServer !== undefined) updateData.acrLoginServer = data.acrLoginServer
    if (data.acrUsername !== undefined) updateData.acrUsername = data.acrUsername
    if (data.acrToken) updateData.acrToken = data.acrToken

    const registry = await payload.update({
      collection: 'registry-configs',
      id,
      data: updateData as any,
    })

    return { success: true, registry: registry as unknown as RegistryConfig }
  } catch (error) {
    console.error('Failed to update registry:', error)
    return { success: false, error: 'Failed to update registry' }
  }
}

/**
 * Delete a registry config
 */
export async function deleteRegistry(id: string): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get the registry to find its workspace
  const existingRegistry = await payload.findByID({
    collection: 'registry-configs',
    id,
  })

  if (!existingRegistry) {
    return { success: false, error: 'Registry not found' }
  }

  const workspaceId = typeof existingRegistry.workspace === 'string'
    ? existingRegistry.workspace
    : existingRegistry.workspace.id

  // Verify user is owner of the workspace (only owners can delete)
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { equals: 'owner' } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Only workspace owners can delete registries' }
  }

  try {
    await payload.delete({
      collection: 'registry-configs',
      id,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete registry:', error)
    return { success: false, error: 'Failed to delete registry' }
  }
}

/**
 * Test GHCR connection and update validation status
 */
export async function testGhcrConnection(configId: string): Promise<{
  success: boolean
  error?: string
}> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get the registry config
  const registryConfig = await payload.findByID({
    collection: 'registry-configs',
    id: configId,
    overrideAccess: true,
  })

  if (!registryConfig) {
    return { success: false, error: 'Registry not found' }
  }

  if (registryConfig.type !== 'ghcr') {
    return { success: false, error: 'Not a GHCR registry' }
  }

  // Access ghcrPat field (exists in schema but not in generated types yet)
  const ghcrPat = (registryConfig as any).ghcrPat as string | undefined
  if (!ghcrPat) {
    return { success: false, error: 'No PAT configured' }
  }

  // Verify user has access to this registry's workspace
  const workspaceId =
    typeof registryConfig.workspace === 'string'
      ? registryConfig.workspace
      : registryConfig.workspace.id

  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not authorized for this workspace' }
  }

  try {
    // Decrypt PAT and test GitHub API
    const pat = decrypt(ghcrPat)

    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    const isValid = response.ok

    // Update validation status
    await payload.update({
      collection: 'registry-configs',
      id: configId,
      data: {
        ghcrValidationStatus: isValid ? 'valid' : 'invalid',
        ghcrValidatedAt: isValid ? new Date().toISOString() : null,
      } as any,
      overrideAccess: true,
    })

    if (!isValid) {
      const errorBody = await response.text()
      console.error('[GHCR Test] Validation failed:', response.status, errorBody)
      return {
        success: false,
        error: `GitHub API returned ${response.status}. Check that your PAT has write:packages scope.`,
      }
    }

    return { success: true }
  } catch (error) {
    console.error('[GHCR Test] Connection error:', error)
    return { success: false, error: 'Failed to connect to GitHub API' }
  }
}

/**
 * Test ACR connection and update validation status
 */
export async function testAcrConnection(configId: string): Promise<{
  success: boolean
  error?: string
}> {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get the registry config
  const registryConfig = await payload.findByID({
    collection: 'registry-configs',
    id: configId,
    overrideAccess: true,
  })

  if (!registryConfig) {
    return { success: false, error: 'Registry not found' }
  }

  if (registryConfig.type !== 'acr') {
    return { success: false, error: 'Not an ACR registry' }
  }

  // Access ACR fields
  const acrToken = (registryConfig as any).acrToken as string | undefined
  const acrUsername = registryConfig.acrUsername as string | undefined
  const acrLoginServer = registryConfig.acrLoginServer as string | undefined

  if (!acrToken) {
    return { success: false, error: 'No token configured' }
  }

  if (!acrUsername) {
    return { success: false, error: 'No username configured' }
  }

  if (!acrLoginServer) {
    return { success: false, error: 'No login server configured' }
  }

  // Verify user has access to this registry's workspace
  const workspaceId =
    typeof registryConfig.workspace === 'string'
      ? registryConfig.workspace
      : registryConfig.workspace.id

  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not authorized for this workspace' }
  }

  try {
    // Decrypt token and test Azure Container Registry API
    const token = decrypt(acrToken)

    // ACR uses Basic auth with username:token
    const credentials = Buffer.from(`${acrUsername}:${token}`).toString('base64')

    const response = await fetch(`https://${acrLoginServer}/v2/`, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    })

    const isValid = response.ok

    // Update validation status
    await payload.update({
      collection: 'registry-configs',
      id: configId,
      data: {
        acrValidationStatus: isValid ? 'valid' : 'invalid',
        acrValidatedAt: isValid ? new Date().toISOString() : null,
      } as any,
      overrideAccess: true,
    })

    if (!isValid) {
      const errorBody = await response.text()
      console.error('[ACR Test] Validation failed:', response.status, errorBody)
      return {
        success: false,
        error: `ACR API returned ${response.status}. Check your credentials.`,
      }
    }

    return { success: true }
  } catch (error) {
    console.error('[ACR Test] Connection error:', error)
    return { success: false, error: 'Failed to connect to ACR' }
  }
}
