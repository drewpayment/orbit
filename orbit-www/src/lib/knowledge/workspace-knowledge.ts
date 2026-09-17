import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { membershipRole, type WorkspaceRole } from '@/lib/authz/membership'

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

/**
 * `userId` is the caller's Better-Auth id. SEMANTIC NOTE (Phase C, #135): the
 * original inline query allowed a `'contributor'` role that has never existed
 * on `workspace-members` (the collection only defines owner/admin/member), so
 * this was already owner/admin-only in practice; `membershipRole` makes that
 * explicit instead of encoding a non-existent role.
 */
export async function canUserManageKnowledgeSpaces(
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const payload = await getPayload({ config: configPromise })
  const role = await membershipRole(payload, userId, workspaceId)
  const manageRoles: readonly WorkspaceRole[] = ['owner', 'admin']
  return role !== null && manageRoles.includes(role)
}
