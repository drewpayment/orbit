'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import type { CatalogEntity, CatalogRelation } from '@/payload-types'

/** A knowledge page best-effort linked to a catalog entity (via tag == slug). */
export interface LinkedDoc {
  id: string
  title: string
  spaceName: string | null
  updatedAt: string
}

export interface EntityDetailData {
  entity: CatalogEntity
  relations: CatalogRelation[]
  docs: LinkedDoc[]
}

/**
 * Fetch a catalog entity, its immediate (depth-1) relations, and any knowledge
 * pages linked to it. All reads pass the authenticated Payload user so the
 * collection's workspace-scoped access control applies — a user outside the
 * entity's workspace gets a not-found (the access filter excludes the row).
 */
export async function getCatalogEntityDetail(id: string): Promise<EntityDetailData | null> {
  const user = await getPayloadUserFromSession()
  if (!user) return null

  const payload = await getPayload({ config })

  let entity: CatalogEntity
  try {
    entity = (await payload.findByID({
      collection: 'catalog-entities',
      id,
      // depth 2 populates `owner` (a team entity) and `workspace`.
      depth: 2,
      user,
    })) as CatalogEntity
  } catch {
    // findByID throws when the row is missing or filtered out by access control.
    return null
  }

  if (!entity) return null

  // Relations touching this entity in either direction. depth 1 populates the
  // `from`/`to` entities so the UI can render neighbour names and links.
  const relationsRes = await payload.find({
    collection: 'catalog-relations',
    where: {
      or: [{ from: { equals: id } }, { to: { equals: id } }],
    },
    depth: 1,
    limit: 200,
    user,
  })

  const docs = await findLinkedDocs(payload, entity, user)

  return {
    entity,
    relations: relationsRes.docs as CatalogRelation[],
    docs,
  }
}

/**
 * Knowledge pages have no first-class relation to catalog entities, so we use a
 * lightweight, conventional link: a published knowledge page tagged with the
 * entity's slug is treated as documentation for that entity. No slug → no link.
 */
async function findLinkedDocs(
  payload: Awaited<ReturnType<typeof getPayload>>,
  entity: CatalogEntity,
  user: NonNullable<Awaited<ReturnType<typeof getPayloadUserFromSession>>>,
): Promise<LinkedDoc[]> {
  if (!entity.slug) return []

  try {
    const pages = await payload.find({
      collection: 'knowledge-pages',
      where: {
        and: [{ 'tags.tag': { equals: entity.slug } }, { status: { equals: 'published' } }],
      },
      depth: 1,
      limit: 25,
      user,
    })

    return pages.docs.map((page) => ({
      id: String(page.id),
      title: page.title,
      spaceName:
        page.knowledgeSpace && typeof page.knowledgeSpace === 'object'
          ? page.knowledgeSpace.name
          : null,
      updatedAt: page.updatedAt,
    }))
  } catch {
    // Knowledge collection access can reject; treat as "no docs" rather than 500.
    return []
  }
}
