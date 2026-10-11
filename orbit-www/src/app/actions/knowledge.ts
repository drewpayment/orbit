'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getActor, type Actor } from '@/lib/authz'
import type { BlockDocument } from '@/lib/blocks/types'

// Identity always comes from the session (`getActor`) and every read/write
// runs under the collection access rules as that actor (`overrideAccess:
// false`); no action accepts a client-supplied user id.

const relId = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null

/** Read a page as the actor (collection access applies); throws if not visible. */
async function readPageAs(payload: Awaited<ReturnType<typeof getPayload>>, actor: Actor, id: string) {
  return payload.findByID({
    collection: 'knowledge-pages',
    id,
    depth: 0,
    user: actor.user,
    overrideAccess: false,
  })
}

export async function createKnowledgeSpace(data: {
  name: string
  description?: string
  icon?: string
  visibility: 'private' | 'internal' | 'public'
  workspaceSlug: string
}) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  // Look up workspace by slug
  const workspacesResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: data.workspaceSlug } },
    limit: 1,
    overrideAccess: true,
  })

  if (workspacesResult.docs.length === 0) {
    throw new Error('Workspace not found')
  }

  const workspace = workspacesResult.docs[0]

  const slug = data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const space = await payload.create({
    collection: 'knowledge-spaces',
    data: {
      workspace: workspace.id,
      name: data.name,
      slug,
      description: data.description || undefined,
      icon: data.icon || undefined,
      visibility: data.visibility,
    },
    user: actor.user,
    overrideAccess: false,
  })

  revalidatePath(`/workspaces/${data.workspaceSlug}/knowledge`)

  return space
}

export async function createKnowledgePage(data: {
  title: string
  slug: string
  knowledgeSpaceId: string
  parentPageId?: string
  workspaceSlug: string
  spaceSlug: string
}) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  // A parent must live in the same space (and be visible to the caller).
  if (data.parentPageId) {
    const parent = await readPageAs(payload, actor, data.parentPageId).catch(() => null)
    if (!parent || relId(parent.knowledgeSpace) !== data.knowledgeSpaceId) {
      throw new Error('Parent page not found')
    }
  }

  // Create the page with empty block content
  const page = await payload.create({
    collection: 'knowledge-pages',
    data: {
      title: data.title,
      slug: data.slug,
      knowledgeSpace: data.knowledgeSpaceId,
      parentPage: data.parentPageId || null,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [],
          },
        ],
      },
      contentFormat: 'blocks',
      status: 'draft',
      author: actor.payloadId,
      lastEditedBy: actor.payloadId,
      version: 1,
      sortOrder: 0,
      tags: [],
    },
    user: actor.user,
    overrideAccess: false,
  })

  // Revalidate the space page to show the new page
  revalidatePath(`/workspaces/${data.workspaceSlug}/knowledge/${data.spaceSlug}`)

  return page
}

export async function renamePage(
  pageId: string,
  newTitle: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      title: newTitle,
    },
    user: actor.user,
    overrideAccess: false,
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function movePage(
  pageId: string,
  newParentId: string | null,
  workspaceSlug: string,
  spaceSlug: string
) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  // A new parent must be a different page in the same space.
  if (newParentId) {
    if (newParentId === pageId) throw new Error('Parent page not found')
    const [page, parent] = await Promise.all([
      readPageAs(payload, actor, pageId),
      readPageAs(payload, actor, newParentId).catch(() => null),
    ])
    if (!parent || relId(parent.knowledgeSpace) !== relId(page.knowledgeSpace)) {
      throw new Error('Parent page not found')
    }
  }

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      parentPage: newParentId,
    },
    user: actor.user,
    overrideAccess: false,
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function duplicatePage(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  // Get original page
  const original = await payload.findByID({
    collection: 'knowledge-pages',
    id: pageId,
    user: actor.user,
    overrideAccess: false,
  })

  // Create duplicate with unique slug
  const baseSlug = original.slug ? `${original.slug}-copy` : `page-${Date.now()}`
  const duplicate = await payload.create({
    collection: 'knowledge-pages',
    data: {
      title: `${original.title} (Copy)`,
      slug: baseSlug,
      content: original.content,
      knowledgeSpace: original.knowledgeSpace,
      parentPage: original.parentPage,
      author: actor.payloadId,
      lastEditedBy: actor.payloadId,
      status: 'draft',
      sortOrder: (original.sortOrder ?? 0) + 1,
      version: 1,
    },
    user: actor.user,
    overrideAccess: false,
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
  return duplicate
}

export async function deletePage(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'knowledge-pages',
    id: pageId,
    user: actor.user,
    overrideAccess: false,
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function updatePageSortOrder(
  activePageId: string,
  overPageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  'use server'

  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  // Fetch both pages to get their parent
  const activePage = await payload.findByID({
    collection: 'knowledge-pages',
    id: activePageId,
    user: actor.user,
    overrideAccess: false,
  })

  const overPage = await payload.findByID({
    collection: 'knowledge-pages',
    id: overPageId,
    user: actor.user,
    overrideAccess: false,
  })

  if (relId(activePage.knowledgeSpace) !== relId(overPage.knowledgeSpace)) {
    throw new Error('Pages must be in the same space')
  }

  // Get parent ID (handle both string and object formats)
  const getParentId = (page: any): string | null => {
    if (!page.parentPage) return null
    if (typeof page.parentPage === 'string') return page.parentPage
    if (typeof page.parentPage === 'object' && page.parentPage.id) return page.parentPage.id
    return null
  }

  const parentId = getParentId(activePage)

  // Get all sibling pages (same parent)
  const siblings = await payload.find({
    collection: 'knowledge-pages',
    where: {
      knowledgeSpace: { equals: relId(activePage.knowledgeSpace) },
      parentPage: parentId ? { equals: parentId } : { exists: false },
    },
    sort: 'sortOrder',
    limit: 1000,
    user: actor.user,
    overrideAccess: false,
  })

  // Reorder: remove active page and insert at over page's position
  const siblingList = siblings.docs.filter(p => p.id !== activePageId)
  const overIndex = siblingList.findIndex(p => p.id === overPageId)

  if (overIndex === -1) {
    // Over page not found, append to end
    siblingList.push(activePage)
  } else {
    // Insert before the over page
    siblingList.splice(overIndex, 0, activePage)
  }

  // Update sort orders for all siblings
  await Promise.all(
    siblingList.map((page, index) =>
      payload.update({
        collection: 'knowledge-pages',
        id: page.id,
        data: { sortOrder: index },
        user: actor.user,
        overrideAccess: false,
      })
    )
  )

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function updatePageContent(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string,
  pageSlug: string,
  content: BlockDocument
) {
  const actor = await getActor()
  if (!actor) {
    throw new Error('Not authenticated')
  }

  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      content: content as unknown as Record<string, unknown>,
      contentFormat: 'blocks',
    },
    user: actor.user,
    overrideAccess: false,
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}/${pageSlug}`)
}
