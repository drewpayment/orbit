'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import type { CatalogEntity, EntityScore, EntityType } from '@/payload-types'
import { getCurrentUser } from '@/lib/auth/session'
import { DEFAULT_ENTITY_TYPE } from '@/lib/catalog/entity-types'
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

// ---------------------------------------------------------------------------
// getOverallEntityScores — batched catalog-list score chips
// ---------------------------------------------------------------------------

export interface EntityOverallScore {
  score: number
  goldenPathAlignment: number | null
  /**
   * True when no entity-scores row exists yet and `score` is the entity
   * type's inherited base value, materialized on the fly (the persisted row
   * appears after the workspace's first evaluation/recompute).
   */
  baseline?: boolean
}

/**
 * Overall entity-scores rows (scope='overall') for a batch of catalog
 * entities, keyed by entity id — the single-round-trip source for the
 * catalog list's numeric score chip (`EntityList`/`EntityListItem`, Entity
 * Scores & Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 * One query for the whole visible page instead of one per rendered card.
 *
 * Resolves the session user itself (mirrors `getEntityScoreSummary` in
 * scorecards/actions.ts): this is invoked from a client component, so a
 * client-supplied identity can't be trusted for the workspace boundary.
 */
export async function getOverallEntityScores(
  entityIds: string[],
): Promise<Record<string, EntityOverallScore>> {
  const empty: Record<string, EntityOverallScore> = {}
  if (entityIds.length === 0) return empty

  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return empty

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return empty

  const result = await payload.find({
    collection: 'entity-scores',
    where: {
      and: [
        { entity: { in: entityIds } },
        { scope: { equals: 'overall' } },
        { workspace: { in: workspaceIds } },
      ],
    },
    limit: entityIds.length,
    depth: 0,
    overrideAccess: true,
  })

  const map: Record<string, EntityOverallScore> = {}
  for (const row of result.docs as EntityScore[]) {
    const entityId = typeof row.entity === 'string' ? row.entity : row.entity.id
    map[entityId] = { score: row.score, goldenPathAlignment: row.goldenPathAlignment ?? null }
  }

  // Entities with no persisted overall row yet (their workspace has never run
  // a recompute) fall back to the entity type's inherited base value — the
  // same seed `recomputeWorkspaceScores` would write — so the catalog never
  // shows "No score" for an entity the user can see. Two batched queries:
  // the missing entities (for kind/workspace), then every entity-types row in
  // those workspaces.
  const missing = entityIds.filter((id) => !(id in map))
  if (missing.length === 0) return map

  const missingEntities = await payload.find({
    collection: 'catalog-entities',
    where: {
      and: [{ id: { in: missing } }, { workspace: { in: workspaceIds } }],
    },
    limit: missing.length,
    depth: 0,
    overrideAccess: true,
  })
  if (missingEntities.docs.length === 0) return map

  const wsOf = (v: string | { id: string }) => (typeof v === 'string' ? v : v.id)
  const missingWorkspaceIds = [
    ...new Set(missingEntities.docs.map((e) => wsOf((e as CatalogEntity).workspace))),
  ]
  const typeRows = await payload.find({
    collection: 'entity-types',
    where: { workspace: { in: missingWorkspaceIds } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const baseValueByWsKind = new Map<string, number>()
  for (const t of typeRows.docs as EntityType[]) {
    baseValueByWsKind.set(
      `${wsOf(t.workspace)}:${t.kind}`,
      t.baseValue ?? DEFAULT_ENTITY_TYPE.baseValue,
    )
  }

  for (const doc of missingEntities.docs as CatalogEntity[]) {
    map[doc.id] = {
      score:
        baseValueByWsKind.get(`${wsOf(doc.workspace)}:${doc.kind}`) ??
        DEFAULT_ENTITY_TYPE.baseValue,
      goldenPathAlignment: null,
      baseline: true,
    }
  }
  return map
}
