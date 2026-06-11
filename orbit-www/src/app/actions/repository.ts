'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { repositoryServerClient } from '@/lib/clients/repository-server-client'
import { Visibility } from '@/lib/proto/common_pb'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { requireWorkspaceMembership, WorkspaceMembershipError } from '@/lib/auth/workspace-membership'

const visibilityMap: Record<'private' | 'internal' | 'public', Visibility> = {
  private: Visibility.PRIVATE,
  internal: Visibility.INTERNAL,
  public: Visibility.PUBLIC,
}

export async function createRepositoryAction(input: {
  workspaceId: string
  name: string
  slug: string
  description: string
  visibility: 'private' | 'internal' | 'public'
  templateId: string
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { success: false as const, error: 'Unauthorized', repositoryId: null }
  }

  try {
    const payload = await getPayload({ config })
    await requireWorkspaceMembership(payload, session.user.id, input.workspaceId)
  } catch (error) {
    if (error instanceof WorkspaceMembershipError) {
      return { success: false as const, error: error.message, repositoryId: null }
    }
    throw error
  }

  try {
    const response = await repositoryServerClient.createRepository({
      ...input,
      visibility: visibilityMap[input.visibility],
    })
    const repositoryId = response.repository?.metadata?.id ?? null
    return { success: true as const, repositoryId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create repository'
    return { success: false as const, error: message, repositoryId: null }
  }
}
