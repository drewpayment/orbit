'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import type { Where } from 'payload'
import { getActor, memberWorkspaceIds } from '@/lib/authz'

export interface SearchAPIsInput {
  query?: string
  status?: 'draft' | 'published' | 'deprecated'
  workspaceId?: string
  tags?: string[]
  limit?: number
  page?: number
}

export async function searchAPIs(input: SearchAPIsInput = {}) {
  const payload = await getPayload({ config })

  const { query, status, workspaceId, tags, limit = 20, page = 1 } = input

  // Build where clause for visibility-based access
  const conditions: Where[] = []

  // Public APIs are visible only if NOT in draft status
  const visibilityConditions: Where[] = [
    {
      and: [
        { visibility: { equals: 'public' } },
        { status: { not_equals: 'draft' } },
      ],
    },
  ]

  // Identity is resolved from the session, never a client-supplied id.
  const actor = await getActor()
  if (actor) {
    // SEMANTIC CHANGE: the old code used ONE `userId` (the Better-Auth session
    // id from getCurrentUser) for both this membership lookup AND the
    // `createdBy` filter below. `workspace-members.user` stores the
    // Better-Auth id (this part happened to work), but `createdBy` is a
    // `relationTo: 'users'` field keyed on the Payload id — so "private APIs
    // created by the user" never matched except when a user's Better-Auth id
    // and Payload id happen to be equal. Fixed here by using
    // `actor.betterAuthId` for membership and `actor.payloadId` for `createdBy`.
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

  conditions.push({ or: visibilityConditions })

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

  const schema = await payload.findByID({
    collection: 'api-schemas',
    id,
    depth: 2,
    overrideAccess: true,
  })

  return schema
}

export async function getAPIVersions(schemaId: string) {
  const payload = await getPayload({ config })

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
  const payload = await getPayload({ config })

  const workspaces = await payload.find({
    collection: 'workspaces',
    limit: 100,
    overrideAccess: true,
  })

  return workspaces.docs
}

export async function getAllTags() {
  const payload = await getPayload({ config })

  // Get all schemas and extract unique tags
  const schemas = await payload.find({
    collection: 'api-schemas',
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
