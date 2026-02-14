'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { builtInGenerators } from '@/lib/seeds/deployment-generators'

interface CreateAppFromTemplateInput {
  name: string
  description?: string
  repositoryOwner: string
  repositoryName: string
  repositoryUrl: string
  templateId: string
  workspaceId: string
  installationId?: string
}

export async function createAppFromTemplate(input: CreateAppFromTemplateInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  try {
    const app = await payload.create({
      collection: 'apps',
      data: {
        name: input.name,
        description: input.description,
        workspace: input.workspaceId,
        repository: {
          owner: input.repositoryOwner,
          name: input.repositoryName,
          url: input.repositoryUrl,
          ...(input.installationId && { installationId: input.installationId }),
        },
        origin: {
          type: 'template',
          template: input.templateId,
          instantiatedAt: new Date().toISOString(),
        },
        status: 'unknown',
        syncEnabled: false,
      },
    })

    return { success: true, appId: app.id }
  } catch (error) {
    console.error('Failed to create app:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create app'
    return { success: false, error: errorMessage }
  }
}

interface ImportRepositoryInput {
  workspaceId: string
  repositoryUrl: string
  name: string
  description?: string
  installationId?: string
}

export async function importRepository(input: ImportRepositoryInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Parse repository URL
  const match = input.repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) {
    return { success: false, error: 'Invalid GitHub repository URL' }
  }

  const [, owner, repoName] = match

  try {
    const app = await payload.create({
      collection: 'apps',
      data: {
        name: input.name,
        description: input.description,
        workspace: input.workspaceId,
        repository: {
          owner,
          name: repoName.replace(/\.git$/, ''),
          url: input.repositoryUrl,
          ...(input.installationId && { installationId: input.installationId }),
        },
        origin: {
          type: 'imported',
        },
        status: 'unknown',
        syncEnabled: false,
      },
    })

    return { success: true, appId: app.id }
  } catch (error) {
    console.error('Failed to import repository:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to import repository'
    return { success: false, error: errorMessage }
  }
}

export async function seedBuiltInGenerators() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  try {
    for (const generator of builtInGenerators) {
      // Check if already exists
      const existing = await payload.find({
        collection: 'deployment-generators',
        where: { slug: { equals: generator.slug } },
        limit: 1,
      })

      if (existing.docs.length === 0) {
        await payload.create({
          collection: 'deployment-generators',
          data: generator,
        })
        console.log(`Created built-in generator: ${generator.name}`)
      } else {
        console.log(`Built-in generator already exists: ${generator.name}`)
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to seed built-in generators:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to seed generators'
    return { success: false, error: errorMessage }
  }
}

interface CreateManualAppInput {
  name: string
  description?: string
  workspaceId: string
  repositoryUrl?: string
  healthConfig?: {
    url?: string
    interval?: number
    timeout?: number
    method?: 'GET' | 'HEAD' | 'POST'
    expectedStatus?: number
  }
}

export async function createManualApp(input: CreateManualAppInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // Parse repository URL if provided
  let repositoryData: { owner?: string; name?: string; url?: string } | undefined
  if (input.repositoryUrl) {
    const match = input.repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (match) {
      const [, owner, repoName] = match
      repositoryData = {
        owner,
        name: repoName.replace(/\.git$/, ''),
        url: input.repositoryUrl,
      }
    } else {
      // Allow non-GitHub URLs
      repositoryData = {
        url: input.repositoryUrl,
      }
    }
  }

  try {
    const app = await payload.create({
      collection: 'apps',
      data: {
        name: input.name,
        description: input.description,
        workspace: input.workspaceId,
        ...(repositoryData && { repository: repositoryData }),
        origin: {
          type: 'manual',
        },
        status: 'unknown',
        syncEnabled: false,
        healthConfig: {
          url: input.healthConfig?.url,
          interval: input.healthConfig?.interval || 60,
          timeout: input.healthConfig?.timeout || 10,
          method: input.healthConfig?.method || 'GET',
          expectedStatus: input.healthConfig?.expectedStatus || 200,
        },
      },
    })

    return { success: true, appId: app.id }
  } catch (error) {
    console.error('Failed to create app:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create app'
    return { success: false, error: errorMessage }
  }
}

interface GetHealthHistoryInput {
  appId: string
  limit?: number
}

export async function getHealthHistory(input: GetHealthHistoryInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized', data: [] }
  }

  const payload = await getPayload({ config })

  // Verify user has access to this app
  const app = await payload.findByID({
    collection: 'apps',
    id: input.appId,
  })

  if (!app) {
    return { success: false, error: 'App not found', data: [] }
  }

  try {
    const healthChecks = await payload.find({
      collection: 'health-checks',
      where: {
        app: { equals: input.appId },
      },
      sort: '-checkedAt',
      limit: input.limit || 20,
    })

    return {
      success: true,
      data: healthChecks.docs,
    }
  } catch (error) {
    console.error('Failed to fetch health history:', error)
    return { success: false, error: 'Failed to fetch health history', data: [] }
  }
}

interface UpdateAppSettingsInput {
  name: string
  description?: string
  healthConfig?: {
    url?: string
    method?: 'GET' | 'HEAD' | 'POST'
    interval?: number
    timeout?: number
    expectedStatus?: number
  }
  branch?: string
}

export async function updateAppSettings(
  appId: string,
  data: UpdateAppSettingsInput
): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Fetch app to get workspace ID
  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  const workspaceId = typeof app.workspace === 'string' ? app.workspace : app.workspace.id

  // Verify user has workspace member access
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin', 'member'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not authorized to update this app' }
  }

  try {
    // Build update data
    const updateData: Record<string, unknown> = {
      name: data.name,
      description: data.description || null,
    }

    // Update health config if provided
    if (data.healthConfig) {
      updateData.healthConfig = {
        url: data.healthConfig.url || null,
        method: data.healthConfig.method || 'GET',
        interval: data.healthConfig.interval || 60,
        timeout: data.healthConfig.timeout || 10,
        expectedStatus: data.healthConfig.expectedStatus || 200,
      }
    }

    // Update branch if provided and app has repository
    if (data.branch && app.repository) {
      updateData.repository = {
        ...app.repository,
        branch: data.branch,
      }
    }

    await payload.update({
      collection: 'apps',
      id: appId,
      data: updateData,
    })

    revalidatePath('/apps')
    revalidatePath(`/apps/${appId}`)

    return { success: true }
  } catch (error) {
    console.error('Failed to update app settings:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to update app settings'
    return { success: false, error: errorMessage }
  }
}

export async function deleteApp(
  appId: string,
  confirmName: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

  // Fetch app to get name and workspace ID
  const app = await payload.findByID({
    collection: 'apps',
    id: appId,
  })

  if (!app) {
    return { success: false, error: 'App not found' }
  }

  // Validate confirmation name matches exactly
  if (confirmName !== app.name) {
    return { success: false, error: 'App name does not match' }
  }

  const workspaceId = typeof app.workspace === 'string' ? app.workspace : app.workspace.id

  // Verify user has owner/admin role (not just member)
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
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Only workspace owners and admins can delete apps' }
  }

  try {
    // Delete app - Payload hooks handle cascade deletion of related entities
    await payload.delete({
      collection: 'apps',
      id: appId,
    })

    revalidatePath('/apps')

    return { success: true }
  } catch (error) {
    console.error('Failed to delete app:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete app'
    return { success: false, error: errorMessage }
  }
}
