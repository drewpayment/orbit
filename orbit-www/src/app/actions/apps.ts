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
          installationId: input.installationId || '',
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
          installationId: '', // Will be set when user connects GitHub
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
