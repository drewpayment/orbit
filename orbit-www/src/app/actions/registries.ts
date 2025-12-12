'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export interface RegistryConfig {
  id: string
  name: string
  type: 'ghcr' | 'acr'
  isDefault: boolean
  workspace: { id: string; name: string; slug: string }
  ghcrOwner?: string
  acrLoginServer?: string
  acrUsername?: string
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
  type: 'ghcr' | 'acr'
  workspace: string
  isDefault?: boolean
  ghcrOwner?: string
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
    } else {
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
