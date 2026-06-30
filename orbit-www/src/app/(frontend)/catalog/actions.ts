'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import type { CatalogEntity } from '@/payload-types'
import {
  buildCatalogWhere,
  ENTITY_KIND_VALUES,
  isEntityKind,
  type EntityKind,
} from '@/components/features/catalog/catalog-query'

/**
 * Resolve the set of workspace IDs the given user is an active member of.
 * This is the tenant boundary for every catalog query below — mirrors the
 * workspace-membership filtering used in `catalog/apis/actions.ts`.
 */
async function getMemberWorkspaceIds(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
): Promise<string[]> {
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: userId },
      status: { equals: 'active' },
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  return memberships.docs.map((m) =>
    typeof m.workspace === 'string' ? m.workspace : m.workspace.id,
  )
}

export interface SearchCatalogInput {
  userId?: string
  kind?: string
  query?: string
  limit?: number
  page?: number
}

export interface SearchCatalogResult {
  docs: CatalogEntity[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/**
 * Search catalog entities scoped to the current user's workspaces.
 *
 * We query with `overrideAccess: true` and supply the workspace `in` filter
 * ourselves (via {@link buildCatalogWhere}) so the result set is the tenant
 * boundary regardless of the collection's own access rules.
 */
export async function searchCatalogEntities(
  input: SearchCatalogInput = {},
): Promise<SearchCatalogResult> {
  const payload = await getPayload({ config })
  const { userId, kind, query, limit = 24, page = 1 } = input

  const empty: SearchCatalogResult = {
    docs: [],
    totalDocs: 0,
    totalPages: 0,
    page: 1,
    hasNextPage: false,
    hasPrevPage: false,
  }

  if (!userId) return empty

  const workspaceIds = await getMemberWorkspaceIds(payload, userId)
  if (workspaceIds.length === 0) return empty

  const where = buildCatalogWhere({
    workspaceIds,
    kind: isEntityKind(kind) ? kind : undefined,
    query,
  })

  const result = await payload.find({
    collection: 'catalog-entities',
    where,
    sort: 'name',
    limit,
    page,
    depth: 1, // resolve workspace + owner relationships for display
    overrideAccess: true,
  })

  return {
    docs: result.docs,
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page: result.page ?? 1,
    hasNextPage: result.hasNextPage ?? false,
    hasPrevPage: result.hasPrevPage ?? false,
  }
}

export type CatalogKindCounts = {
  all: number
  byKind: Record<EntityKind, number>
}

/**
 * Per-kind entity counts for the current user's workspaces, used to drive the
 * kind tabs (which tabs to surface, and their count badges). Respects the
 * active text `query` so counts track the visible result set.
 */
export async function getCatalogKindCounts(
  input: { userId?: string; query?: string } = {},
): Promise<CatalogKindCounts> {
  const payload = await getPayload({ config })
  const { userId, query } = input

  const zero = ENTITY_KIND_VALUES.reduce(
    (acc, k) => ({ ...acc, [k]: 0 }),
    {} as Record<EntityKind, number>,
  )

  if (!userId) return { all: 0, byKind: zero }

  const workspaceIds = await getMemberWorkspaceIds(payload, userId)
  if (workspaceIds.length === 0) return { all: 0, byKind: zero }

  const counts = await Promise.all(
    ENTITY_KIND_VALUES.map((kind) =>
      payload
        .count({
          collection: 'catalog-entities',
          where: buildCatalogWhere({ workspaceIds, kind, query }),
          overrideAccess: true,
        })
        .then((r) => [kind, r.totalDocs] as const),
    ),
  )

  const byKind = counts.reduce(
    (acc, [kind, total]) => ({ ...acc, [kind]: total }),
    {} as Record<EntityKind, number>,
  )
  const all = counts.reduce((sum, [, total]) => sum + total, 0)

  return { all, byKind }
}
