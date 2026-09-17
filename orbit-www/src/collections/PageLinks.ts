import type { CollectionConfig, Payload } from 'payload'
import { memberCreate, workspaceScopedRead, docWorkspaceMutate, denyAll, relationId } from '@/lib/authz/payload'

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
    // `workspaces.members` is not a real field (no join/relationship by that
    // name exists on Workspaces) — the previous dot-path query could never
    // match anything and silently denied every caller. Resolve the same
    // intent explicitly via the two-hop join: a link is visible if its
    // source page's knowledge space belongs to a workspace the caller
    // actively belongs to.
    read: workspaceScopedRead({
      via: [
        { collection: 'knowledge-spaces', on: 'knowledgeSpace' },
        { collection: 'knowledge-pages', on: 'fromPage' },
      ],
    }),
    create: memberCreate({
      field: 'fromPage',
      resolveWorkspace: async ({ data, payload }) => {
        const fromPageId = relationId((data as { fromPage?: unknown } | undefined)?.fromPage)
        if (!fromPageId) return null
        return resolveWorkspaceIdForFromPage(payload, fromPageId)
      },
    }),
    update: denyAll, // Links are immutable after creation
    delete: docWorkspaceMutate('page-links', ['owner', 'admin', 'member'], {
      resolveWorkspace: async ({ doc, payload }) => {
        const fromPageId = relationId((doc as { fromPage?: unknown }).fromPage)
        if (!fromPageId) return null
        return resolveWorkspaceIdForFromPage(payload, fromPageId)
      },
    }),
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
