'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'

export async function createKnowledgePage(data: {
  title: string
  slug: string
  knowledgeSpaceId: string
  parentPageId?: string
  userId: string
  workspaceSlug: string
  spaceSlug: string
}) {
  const payload = await getPayload({ config })

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
      author: data.userId,
      lastEditedBy: data.userId,
      version: 1,
      sortOrder: 0,
      tags: [],
    },
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
  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      title: newTitle,
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function movePage(
  pageId: string,
  newParentId: string | null,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  await payload.update({
    collection: 'knowledge-pages',
    id: pageId,
    data: {
      parentPage: newParentId,
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}

export async function duplicatePage(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  // Get original page
  const original = await payload.findByID({
    collection: 'knowledge-pages',
    id: pageId,
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
      author: original.author,
      status: 'draft',
      sortOrder: (original.sortOrder ?? 0) + 1,
      version: 1,
    },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
  return duplicate
}

export async function deletePage(
  pageId: string,
  workspaceSlug: string,
  spaceSlug: string
) {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'knowledge-pages',
    id: pageId,
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

  const payload = await getPayload({ config })

  // Fetch both pages to get their parent
  const activePage = await payload.findByID({
    collection: 'knowledge-pages',
    id: activePageId,
  })

  const overPage = await payload.findByID({
    collection: 'knowledge-pages',
    id: overPageId,
  })

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
      knowledgeSpace: { equals: activePage.knowledgeSpace },
      parentPage: parentId ? { equals: parentId } : { exists: false },
    },
    sort: 'sortOrder',
    limit: 1000,
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
      })
    )
  )

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}
