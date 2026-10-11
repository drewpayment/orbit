'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import type { Where } from 'payload'
import { getActor, memberWorkspaceIds, type Actor } from '@/lib/authz'

export interface SearchAPIsInput {
  query?: string
  status?: 'draft' | 'published' | 'deprecated'
  workspaceId?: string
  tags?: string[]
  limit?: number
  page?: number
}

/**
 * The visibility rule for catalog reads. Public APIs are visible only when not
 * draft; workspace-visibility APIs are visible to members of their workspace;
 * private APIs to their creator. Identity comes from the session, never a
 * client-supplied id. Every catalog read below ANDs this in, because they use
 * `overrideAccess: true` (the collection rule would also expose public drafts).
 */
async function visibleSchemasWhere(actor: Actor | null): Promise<Where> {
  const visibilityConditions: Where[] = [
    {
      and: [
        { visibility: { equals: 'public' } },
        { status: { not_equals: 'draft' } },
      ],
    },
  ]

  if (actor) {
    // `workspace-members.user` stores the Better-Auth id (membership lookup);
    // `createdBy` is a `relationTo: 'users'` field keyed on the Payload id.
    const userWorkspaceIds = await memberWorkspaceIds('member', actor)

    if (userWorkspaceIds.length > 0) {
      // Workspace-visible APIs in user's workspaces (they can see drafts in their own workspaces)
      visibilityConditions.push({
        and: [
          { visibility: { equals: 'workspace' } },
          { workspace: { in: userWorkspaceIds } },
        ],
      })
    }

    // Private APIs created by the user (they can see their own drafts).
    visibilityConditions.push({
      and: [
        { visibility: { equals: 'private' } },
        { createdBy: { equals: actor.payloadId } },
      ],
    })
  }

  return { or: visibilityConditions }
}

export async function searchAPIs(input: SearchAPIsInput = {}) {
  const payload = await getPayload({ config })

  const { query, status, workspaceId, tags, limit = 20, page = 1 } = input

  // Build where clause for visibility-based access
  const conditions: Where[] = []

  const actor = await getActor()
  conditions.push(await visibleSchemasWhere(actor))

  // Filter by search query
  if (query) {
    conditions.push({
      or: [
        { name: { contains: query } },
        { description: { contains: query } },
        { specTitle: { contains: query } },
      ],
    })
  }

  // Filter by status
  if (status) {
    conditions.push({ status: { equals: status } })
  }

  // Filter by workspace
  if (workspaceId) {
    conditions.push({ workspace: { equals: workspaceId } })
  }

  // Filter by tags
  if (tags && tags.length > 0) {
    // This is a simplified approach - for full tag filtering,
    // you might need a more complex query or post-filtering
    conditions.push({
      'tags.tag': { in: tags },
    })
  }

  const where: Where = conditions.length > 1
    ? { and: conditions }
    : conditions[0] || {}

  const schemas = await payload.find({
    collection: 'api-schemas',
    where,
    sort: '-updatedAt',
    limit,
    page,
    depth: 1,
    overrideAccess: true,
  })

  return {
    docs: schemas.docs,
    totalDocs: schemas.totalDocs,
    totalPages: schemas.totalPages,
    page: schemas.page,
    hasNextPage: schemas.hasNextPage,
    hasPrevPage: schemas.hasPrevPage,
  }
}

export async function getAPIById(id: string) {
  const payload = await getPayload({ config })
  const actor = await getActor()

  const result = await payload.find({
    collection: 'api-schemas',
    where: { and: [{ id: { equals: id } }, await visibleSchemasWhere(actor)] },
    limit: 1,
    depth: 2,
    overrideAccess: true,
  })

  return result.docs[0] ?? null
}

export async function getAPIVersions(schemaId: string) {
  const payload = await getPayload({ config })

  // Versions are only readable when the parent schema is visible to the caller.
  const schema = await getAPIById(schemaId)
  if (!schema) return []

  const versions = await payload.find({
    collection: 'api-schema-versions',
    where: { schema: { equals: schemaId } },
    sort: '-versionNumber',
    depth: 1,
    overrideAccess: true,
  })

  return versions.docs
}

export async function getAllWorkspaces() {
  const actor = await getActor()
  if (!actor) return []

  const payload = await getPayload({ config })

  // Collection access scopes list queries to the actor's own workspaces.
  const workspaces = await payload.find({
    collection: 'workspaces',
    limit: 100,
    user: actor.user,
    overrideAccess: false,
  })

  return workspaces.docs
}

export async function getAllTags() {
  const payload = await getPayload({ config })
  const actor = await getActor()

  // Only tags from schemas the caller can see.
  const schemas = await payload.find({
    collection: 'api-schemas',
    where: await visibleSchemasWhere(actor),
    limit: 1000,
    overrideAccess: true,
  })

  const tagSet = new Set<string>()
  for (const schema of schemas.docs) {
    const tags = schema.tags as Array<{ tag: string }> | undefined
    if (tags) {
      for (const t of tags) {
        if (t.tag) tagSet.add(t.tag)
      }
    }
  }

  return Array.from(tagSet).sort()
}
