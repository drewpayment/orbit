'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'

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
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized' }
  }

  const payload = await getPayload({ config })

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
    return { success: false, error: 'Failed to create app' }
  }
}
