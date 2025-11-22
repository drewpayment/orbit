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
