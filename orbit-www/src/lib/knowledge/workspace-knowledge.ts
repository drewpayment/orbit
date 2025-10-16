import { getPayload } from 'payload'
import configPromise from '@payload-config'

export interface KnowledgeSpaceWithStats {
  id: string
  name: string
  slug: string
  description?: string
  icon?: string
  visibility: 'private' | 'internal' | 'public'
  pageCount: number
  publishedCount: number
  draftCount: number
}

export async function getWorkspaceKnowledgeSpaces(
  workspaceId: string
): Promise<KnowledgeSpaceWithStats[]> {
  const payload = await getPayload({ config: configPromise })

  // Fetch knowledge spaces for this workspace
  const spacesResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      workspace: { equals: workspaceId },
    },
    limit: 100,
    sort: 'name',
  })

  // Fetch page stats for each space
  const spacesWithStats = await Promise.all(
    spacesResult.docs.map(async (space) => {
      const pagesResult = await payload.find({
        collection: 'knowledge-pages',
        where: {
          knowledgeSpace: { equals: space.id },
        },
        limit: 1000,
      })

      const pages = pagesResult.docs

      return {
        id: space.id,
        name: space.name,
        slug: space.slug,
        description: space.description || undefined,
        icon: space.icon || undefined,
        visibility: space.visibility,
        pageCount: pages.length,
        publishedCount: pages.filter((p) => p.status === 'published').length,
        draftCount: pages.filter((p) => p.status === 'draft').length,
      }
    })
  )

  return spacesWithStats
}

export async function canUserManageKnowledgeSpaces(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const payload = await getPayload({ config: configPromise })

  const membershipsResult = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: userId } },
        { role: { in: ['owner', 'admin', 'contributor'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  return membershipsResult.docs.length > 0
}
