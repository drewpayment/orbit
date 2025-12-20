'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/encryption'
import type { EnvironmentVariable } from '@/payload-types'

// ============================================================================
// Types
// ============================================================================

export interface EnvironmentVariableInput {
  name: string
  value: string
  workspaceId: string
  appId?: string
  useInBuilds?: boolean
  useInDeployments?: boolean
  description?: string
}

export interface BulkImportInput {
  workspaceId: string
  appId?: string
  variables: Array<{
    name: string
    value: string
  }>
  useInBuilds?: boolean
  useInDeployments?: boolean
}

export interface EnvironmentVariableDisplay {
  id: string
  name: string
  maskedValue: string
  workspace: string
  app?: string | null
  useInBuilds: boolean
  useInDeployments: boolean
  description?: string | null
  source: 'workspace' | 'app'
  createdBy?: string
  updatedAt: string
}

// ============================================================================
// Helper Functions
// ============================================================================

async function checkWorkspaceAdminAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const payload = await getPayload({ config })

  const members = await payload.find({
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
  })

  return members.docs.length > 0
}

async function checkWorkspaceMemberAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const payload = await getPayload({ config })

  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  return members.docs.length > 0
}

function maskValue(value: string): string {
  // Return a consistent masked value (don't reveal length)
  return '••••••••'
}

function toDisplayVariable(
  envVar: EnvironmentVariable,
  source: 'workspace' | 'app'
): EnvironmentVariableDisplay {
  return {
    id: envVar.id,
    name: envVar.name,
    maskedValue: maskValue(envVar.value),
    workspace: typeof envVar.workspace === 'string' ? envVar.workspace : envVar.workspace.id,
    app: envVar.app
      ? (typeof envVar.app === 'string' ? envVar.app : envVar.app.id)
      : null,
    useInBuilds: envVar.useInBuilds ?? true,
    useInDeployments: envVar.useInDeployments ?? true,
    description: envVar.description,
    source,
    createdBy: envVar.createdBy
      ? (typeof envVar.createdBy === 'string' ? envVar.createdBy : envVar.createdBy.id)
      : undefined,
    updatedAt: envVar.updatedAt,
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function createEnvironmentVariable(
  input: EnvironmentVariableInput
): Promise<{ success: boolean; error?: string; variable?: EnvironmentVariableDisplay }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const hasAccess = await checkWorkspaceAdminAccess(session.user.id, input.workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'You must be a workspace owner or admin to manage environment variables' }
  }

  const payload = await getPayload({ config })

  try {
    const envVar = await payload.create({
      collection: 'environment-variables',
      data: {
        name: input.name,
        value: input.value, // Will be encrypted by collection hook
        workspace: input.workspaceId,
        app: input.appId || undefined,
        useInBuilds: input.useInBuilds ?? true,
        useInDeployments: input.useInDeployments ?? true,
        description: input.description,
        createdBy: session.user.id,
      },
    })

    return {
      success: true,
      variable: toDisplayVariable(envVar, input.appId ? 'app' : 'workspace'),
    }
  } catch (error) {
    console.error('Failed to create environment variable:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create environment variable',
    }
  }
}

export async function updateEnvironmentVariable(
  id: string,
  input: Partial<EnvironmentVariableInput>
): Promise<{ success: boolean; error?: string; variable?: EnvironmentVariableDisplay }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get existing variable to check workspace access
  const existing = await payload.findByID({
    collection: 'environment-variables',
    id,
  })

  if (!existing) {
    return { success: false, error: 'Environment variable not found' }
  }

  const workspaceId = typeof existing.workspace === 'string'
    ? existing.workspace
    : existing.workspace.id

  const hasAccess = await checkWorkspaceAdminAccess(session.user.id, workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'You must be a workspace owner or admin to manage environment variables' }
  }

  try {
    const updateData: Record<string, unknown> = {}

    if (input.name !== undefined) updateData.name = input.name
    if (input.value !== undefined) updateData.value = input.value // Will be encrypted by hook
    if (input.useInBuilds !== undefined) updateData.useInBuilds = input.useInBuilds
    if (input.useInDeployments !== undefined) updateData.useInDeployments = input.useInDeployments
    if (input.description !== undefined) updateData.description = input.description

    const envVar = await payload.update({
      collection: 'environment-variables',
      id,
      data: updateData,
    })

    return {
      success: true,
      variable: toDisplayVariable(envVar, envVar.app ? 'app' : 'workspace'),
    }
  } catch (error) {
    console.error('Failed to update environment variable:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update environment variable',
    }
  }
}

export async function deleteEnvironmentVariable(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get existing variable to check workspace access
  const existing = await payload.findByID({
    collection: 'environment-variables',
    id,
  })

  if (!existing) {
    return { success: false, error: 'Environment variable not found' }
  }

  const workspaceId = typeof existing.workspace === 'string'
    ? existing.workspace
    : existing.workspace.id

  const hasAccess = await checkWorkspaceAdminAccess(session.user.id, workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'You must be a workspace owner or admin to manage environment variables' }
  }

  try {
    await payload.delete({
      collection: 'environment-variables',
      id,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to delete environment variable:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete environment variable',
    }
  }
}

// ============================================================================
// Bulk Operations
// ============================================================================

export async function bulkImportEnvironmentVariables(
  input: BulkImportInput
): Promise<{ success: boolean; error?: string; imported: number; errors: string[] }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', imported: 0, errors: [] }
  }

  const hasAccess = await checkWorkspaceAdminAccess(session.user.id, input.workspaceId)
  if (!hasAccess) {
    return {
      success: false,
      error: 'You must be a workspace owner or admin to manage environment variables',
      imported: 0,
      errors: [],
    }
  }

  const payload = await getPayload({ config })
  const errors: string[] = []
  let imported = 0

  for (const variable of input.variables) {
    try {
      await payload.create({
        collection: 'environment-variables',
        data: {
          name: variable.name,
          value: variable.value,
          workspace: input.workspaceId,
          app: input.appId || undefined,
          useInBuilds: input.useInBuilds ?? true,
          useInDeployments: input.useInDeployments ?? true,
          createdBy: session.user.id,
        },
      })
      imported++
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      errors.push(`${variable.name}: ${message}`)
    }
  }

  return {
    success: errors.length === 0,
    imported,
    errors,
  }
}

// ============================================================================
// Query Operations
// ============================================================================

export async function getWorkspaceEnvironmentVariables(
  workspaceId: string
): Promise<{ success: boolean; error?: string; variables?: EnvironmentVariableDisplay[] }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const hasAccess = await checkWorkspaceMemberAccess(session.user.id, workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  const payload = await getPayload({ config })

  try {
    const results = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { app: { exists: false } },
        ],
      },
      sort: 'name',
      limit: 1000,
    })

    return {
      success: true,
      variables: results.docs.map((v) => toDisplayVariable(v, 'workspace')),
    }
  } catch (error) {
    console.error('Failed to get workspace environment variables:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get environment variables',
    }
  }
}

export async function getAppEnvironmentVariables(
  appId: string
): Promise<{
  success: boolean
  error?: string
  variables?: EnvironmentVariableDisplay[]
  workspaceVariables?: EnvironmentVariableDisplay[]
}> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get app to find workspace
  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  const workspaceId = typeof app.workspace === 'string'
    ? app.workspace
    : app.workspace.id

  const hasAccess = await checkWorkspaceMemberAccess(session.user.id, workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    // Get app-specific variables
    const appVars = await payload.find({
      collection: 'environment-variables',
      where: {
        app: { equals: appId },
      },
      sort: 'name',
      limit: 1000,
    })

    // Get workspace-level variables (for inheritance display)
    const workspaceVars = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { app: { exists: false } },
        ],
      },
      sort: 'name',
      limit: 1000,
    })

    return {
      success: true,
      variables: appVars.docs.map((v) => toDisplayVariable(v, 'app')),
      workspaceVariables: workspaceVars.docs.map((v) => toDisplayVariable(v, 'workspace')),
    }
  } catch (error) {
    console.error('Failed to get app environment variables:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get environment variables',
    }
  }
}

// ============================================================================
// Resolution Function (for builds/deployments)
// ============================================================================

export async function resolveEnvironmentVariables(
  appId: string,
  usage: 'build' | 'deployment'
): Promise<{ success: boolean; error?: string; variables?: Record<string, string> }> {
  // This is a server-only function - no user auth check needed
  // It's called internally by the build system

  const payload = await getPayload({ config })

  try {
    // Get app to find workspace
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
    })

    if (!app) {
      return { success: false, error: 'App not found' }
    }

    const workspaceId = typeof app.workspace === 'string'
      ? app.workspace
      : app.workspace.id

    // 1. Get workspace-level variables
    const workspaceVars = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { app: { exists: false } },
          usage === 'build'
            ? { useInBuilds: { equals: true } }
            : { useInDeployments: { equals: true } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    // 2. Get app-level overrides
    const appVars = await payload.find({
      collection: 'environment-variables',
      where: {
        and: [
          { app: { equals: appId } },
          usage === 'build'
            ? { useInBuilds: { equals: true } }
            : { useInDeployments: { equals: true } },
        ],
      },
      limit: 1000,
      overrideAccess: true,
    })

    console.log('[ResolveEnv] Found variables:', {
      workspaceVarsCount: workspaceVars.docs.length,
      appVarsCount: appVars.docs.length,
      workspaceVarNames: workspaceVars.docs.map(v => v.name),
      appVarNames: appVars.docs.map(v => v.name),
    })

    // 3. Merge (app overrides workspace)
    const result: Record<string, string> = {}

    for (const v of workspaceVars.docs) {
      try {
        result[v.name] = decrypt(v.value)
      } catch (e) {
        console.error(`Failed to decrypt workspace variable ${v.name}:`, e)
      }
    }

    for (const v of appVars.docs) {
      try {
        result[v.name] = decrypt(v.value)
      } catch (e) {
        console.error(`Failed to decrypt app variable ${v.name}:`, e)
      }
    }

    return { success: true, variables: result }
  } catch (error) {
    console.error('Failed to resolve environment variables:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve environment variables',
    }
  }
}

// ============================================================================
// Reveal Value (for admin UI)
// ============================================================================

export async function revealEnvironmentVariableValue(
  id: string
): Promise<{ success: boolean; error?: string; value?: string }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get variable
  const envVar = await payload.findByID({
    collection: 'environment-variables',
    id,
  })

  if (!envVar) {
    return { success: false, error: 'Environment variable not found' }
  }

  const workspaceId = typeof envVar.workspace === 'string'
    ? envVar.workspace
    : envVar.workspace.id

  // Only admins can reveal values
  const hasAccess = await checkWorkspaceAdminAccess(session.user.id, workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'You must be a workspace owner or admin to reveal values' }
  }

  try {
    const decryptedValue = decrypt(envVar.value)
    return { success: true, value: decryptedValue }
  } catch (error) {
    console.error('Failed to decrypt environment variable:', error)
    return { success: false, error: 'Failed to decrypt value' }
  }
}

// ============================================================================
// Create Override (convenience function for app settings)
// ============================================================================

export async function createAppOverride(
  appId: string,
  workspaceVariableId: string
): Promise<{ success: boolean; error?: string; variable?: EnvironmentVariableDisplay }> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Get the workspace variable to copy
  const workspaceVar = await payload.findByID({
    collection: 'environment-variables',
    id: workspaceVariableId,
  })

  if (!workspaceVar) {
    return { success: false, error: 'Workspace variable not found' }
  }

  const workspaceId = typeof workspaceVar.workspace === 'string'
    ? workspaceVar.workspace
    : workspaceVar.workspace.id

  const hasAccess = await checkWorkspaceAdminAccess(session.user.id, workspaceId)
  if (!hasAccess) {
    return { success: false, error: 'You must be a workspace owner or admin to create overrides' }
  }

  try {
    // Create app-level override with same value (already encrypted)
    const envVar = await payload.create({
      collection: 'environment-variables',
      data: {
        name: workspaceVar.name,
        value: workspaceVar.value, // Already encrypted, hook will skip re-encryption
        workspace: workspaceId,
        app: appId,
        useInBuilds: workspaceVar.useInBuilds,
        useInDeployments: workspaceVar.useInDeployments,
        description: workspaceVar.description,
        createdBy: session.user.id,
      },
    })

    return {
      success: true,
      variable: toDisplayVariable(envVar, 'app'),
    }
  } catch (error) {
    console.error('Failed to create app override:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create override',
    }
  }
}
