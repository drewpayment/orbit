import type { CollectionConfig, Payload } from 'payload'
import { getMemberWorkspaceIds, isWorkspaceMember } from '@/lib/access/workspace-access'

/**
 * Resolve the workspace a `fromPage` (knowledge-pages id) belongs to, via
 * knowledgeSpace → workspace. Missing/broken chain link ⇒ null (deny).
 */
async function resolveWorkspaceIdForFromPage(payload: Payload, fromPageId: string): Promise<string | null> {
  try {
    const page = await payload.findByID({
      collection: 'knowledge-pages',
      id: fromPageId,
      depth: 0,
      overrideAccess: true,
    })
    const spaceId = typeof page.knowledgeSpace === 'string' ? page.knowledgeSpace : page.knowledgeSpace?.id
    if (!spaceId) return null
    const space = await payload.findByID({
      collection: 'knowledge-spaces',
      id: spaceId,
      depth: 0,
      overrideAccess: true,
    })
    const workspaceId = typeof space.workspace === 'string' ? space.workspace : space.workspace?.id
    return workspaceId ?? null
  } catch {
    return null
  }
}

export const PageLinks: CollectionConfig = {
  slug: 'page-links',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['fromPage', 'toPage', 'linkType', 'createdAt'],
    hidden: false,
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false

      // `workspaces.members` is not a real field (no join/relationship by
      // that name exists on Workspaces) — the previous dot-path query could
      // never match anything and silently denied every caller. Resolve the
      // same intent explicitly: a link is visible if its source page's
      // knowledge space belongs to a workspace the caller actively belongs to.
      const betterAuthId = user.betterAuthId
      const workspaceIds = betterAuthId ? await getMemberWorkspaceIds(payload, betterAuthId) : []

      const spaces = await payload.find({
        collection: 'knowledge-spaces',
        where: { workspace: { in: workspaceIds } },
        limit: 1000,
        overrideAccess: true,
      })
      const spaceIds = spaces.docs.map((s) => s.id)

      const pages = await payload.find({
        collection: 'knowledge-pages',
        where: { knowledgeSpace: { in: spaceIds } },
        limit: 1000,
        overrideAccess: true,
      })
      const pageIds = pages.docs.map((p) => p.id)

      return {
        fromPage: { in: pageIds },
      }
    },
    create: async ({ req: { user, payload }, data }) => {
      if (!user) return false
      const betterAuthId = user.betterAuthId
      if (!betterAuthId) return false
      const fromPageId = typeof data?.fromPage === 'string' ? data.fromPage : data?.fromPage?.id
      if (!fromPageId) return false
      const workspaceId = await resolveWorkspaceIdForFromPage(payload, fromPageId)
      if (!workspaceId) return false
      return isWorkspaceMember(payload, betterAuthId, workspaceId)
    },
    update: () => false, // Links are immutable after creation
    delete: async ({ req: { user, payload }, id }) => {
      if (!user || !id) return false
      const betterAuthId = user.betterAuthId
      if (!betterAuthId) return false
      let link
      try {
        link = await payload.findByID({ collection: 'page-links', id: id as string, depth: 0, overrideAccess: true })
      } catch {
        return false
      }
      const fromPageId = typeof link.fromPage === 'string' ? link.fromPage : link.fromPage?.id
      if (!fromPageId) return false
      const workspaceId = await resolveWorkspaceIdForFromPage(payload, fromPageId)
      if (!workspaceId) return false
      return isWorkspaceMember(payload, betterAuthId, workspaceId)
    },
  },
  fields: [
    {
      name: 'fromPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      required: true,
      index: true,
    },
    {
      name: 'toPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      required: true,
      index: true,
    },
    {
      name: 'linkType',
      type: 'select',
      required: true,
      defaultValue: 'mention',
      options: [
        { label: 'Mention', value: 'mention' },
        { label: 'Embed', value: 'embed' },
        { label: 'Reference', value: 'reference' },
      ],
    },
  ],
  timestamps: true,
}
