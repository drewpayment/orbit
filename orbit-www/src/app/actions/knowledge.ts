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

  // Create duplicate
  const duplicate = await payload.create({
    collection: 'knowledge-pages',
    data: {
      title: `${original.title} (Copy)`,
      content: original.content,
      knowledgeSpace: original.knowledgeSpace,
      parentPage: original.parentPage,
      author: original.author,
      status: 'draft',
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

  // Fetch both pages
  const activePage = await payload.findByID({
    collection: 'knowledge-pages',
    id: activePageId,
  })

  const overPage = await payload.findByID({
    collection: 'knowledge-pages',
    id: overPageId,
  })

  // Swap sort orders
  const activeSortOrder = activePage.sortOrder || 0
  const overSortOrder = overPage.sortOrder || 0

  await payload.update({
    collection: 'knowledge-pages',
    id: activePageId,
    data: { sortOrder: overSortOrder },
  })

  await payload.update({
    collection: 'knowledge-pages',
    id: overPageId,
    data: { sortOrder: activeSortOrder },
  })

  revalidatePath(`/workspaces/${workspaceSlug}/knowledge/${spaceSlug}`)
}
