'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
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
        syncMode: 'orbit-primary',
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
        syncMode: 'orbit-primary',
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
        syncMode: 'orbit-primary',
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
