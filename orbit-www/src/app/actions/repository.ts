'use server'

import { repositoryServerClient } from '@/lib/clients/repository-server-client'
import { Visibility } from '@/lib/proto/common_pb'
import { getActor, check } from '@/lib/authz'

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
  const actor = await getActor()
  if (!actor) {
    return { success: false as const, error: 'Unauthorized', repositoryId: null }
  }

  const decision = await check('read', { kind: 'workspace', id: input.workspaceId }, actor)
  if (!decision.allowed) {
    return { success: false as const, error: 'Not a member of this workspace', repositoryId: null }
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
