'use server'

import { getPayload } from 'payload'
import type { Where } from 'payload'
import config from '@payload-config'
import type { CatalogEntity, EntityScore, EntityType } from '@/payload-types'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { DEFAULT_ENTITY_TYPE } from '@/lib/catalog/entity-types'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { getManageableWorkspaceIds } from '@/lib/catalog/entity-authz'
import {
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

export type CatalogScope = 'all' | 'mine'

export interface SearchCatalogInput {
  /** Legacy — identity is resolved from the session; kept for call-site stability. */
  userId?: string
  kind?: string
  query?: string
  limit?: number
  page?: number
  /** 'all' (default) is org-wide; 'mine' restricts to the caller's active workspaces. */
  scope?: CatalogScope
  /** Optional: restrict results to a single workspace (AND-ed with kind/query/scope). */
  workspaceId?: string
}

/**
 * A catalog entity plus the server-computed `canManage` flag for the caller.
 * Extends CatalogEntity (all existing fields preserved), so existing consumers
 * that read `docs` as CatalogEntity keep working.
 */
export type CatalogEntityWithAccess = CatalogEntity & { canManage: boolean }

export interface SearchCatalogResult {
  docs: CatalogEntityWithAccess[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
  /** True when the caller can create at least one entity (platform admin or a member somewhere). */
  canCreate: boolean
  scope: CatalogScope
  /** Echoes the applied single-workspace filter (undefined when unfiltered) for the UI filter chip. */
  workspaceId?: string
}

/**
 * Build the catalog `Where` clause. Unlike the workspace-scoped
 * `buildCatalogWhere`, an absent `workspaceIds` yields NO workspace constraint
 * (org-wide) — the catalog is now the org discovery surface. Passing an explicit
 * (possibly empty) list scopes to those workspaces ('mine').
 */
function buildOrgCatalogWhere(opts: {
  workspaceIds?: string[]
  workspaceId?: string
  kind?: EntityKind
  query?: string
}): Where {
  const conditions: Where[] = []
  if (opts.workspaceIds) {
    conditions.push({
      workspace: { in: opts.workspaceIds.length > 0 ? opts.workspaceIds : ['__none__'] },
    })
  }
  if (opts.workspaceId) conditions.push({ workspace: { equals: opts.workspaceId } })
  if (opts.kind) conditions.push({ kind: { equals: opts.kind } })
  const trimmed = opts.query?.trim()
  if (trimmed) {
    conditions.push({ or: [{ name: { contains: trimmed } }, { description: { contains: trimmed } }] })
  }
  if (conditions.length === 0) return {}
  return conditions.length > 1 ? { and: conditions } : conditions[0]
}

/** Resolve an entity's workspace id (populated or raw), or null for a global entity. */
function entityWorkspaceId(entity: CatalogEntity): string | null {
  const ws = entity.workspace
  if (!ws) return null
  return typeof ws === 'string' ? ws : ws.id
}

/** Can the caller manage this entity? Pure — no query, uses the precomputed manageable set. */
function computeCanManage(
  entity: CatalogEntity,
  isAdmin: boolean,
  manageableWorkspaceIds: Set<string>,
): boolean {
  if (isAdmin) return true
  const wsId = entityWorkspaceId(entity)
  if (!wsId) return false
  return manageableWorkspaceIds.has(wsId)
}

/**
 * Search catalog entities ORG-WIDE for any authenticated user (the catalog is
 * the discovery surface). `scope: 'mine'` restores the workspace-scoped view.
 *
 * Reads run with `overrideAccess: true`; the where clause is the boundary. Each
 * returned doc carries a `canManage` flag computed from a single manageable-ids
 * set (no per-row query). Identity is resolved from the session — the client
 * `userId` is not trusted for authorization.
 */
export async function searchCatalogEntities(
  input: SearchCatalogInput = {},
): Promise<SearchCatalogResult> {
  const payload = await getPayload({ config })
  const { kind, query, limit = 24, page = 1, scope = 'all', workspaceId } = input

  const empty: SearchCatalogResult = {
    docs: [],
    totalDocs: 0,
    totalPages: 0,
    page: 1,
    hasNextPage: false,
    hasPrevPage: false,
    canCreate: false,
    scope,
    workspaceId,
  }

  const sessionUser = await getPayloadUserFromSession()
  if (!sessionUser) return empty

  const isAdmin = isPlatformAdmin(sessionUser)
  const betterAuthId = sessionUser.betterAuthId ?? undefined
  const manageableIds = betterAuthId ? await getManageableWorkspaceIds(payload, betterAuthId) : []
  const manageableSet = new Set(manageableIds)
  const canCreate = isAdmin || manageableIds.length > 0

  let workspaceFilter: string[] | undefined
  if (scope === 'mine') {
    if (manageableIds.length === 0) return { ...empty, canCreate }
    workspaceFilter = manageableIds
  }

  const where = buildOrgCatalogWhere({
    workspaceIds: workspaceFilter,
    workspaceId,
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

  const docs: CatalogEntityWithAccess[] = (result.docs as CatalogEntity[]).map((entity) => ({
    ...entity,
    canManage: computeCanManage(entity, isAdmin, manageableSet),
  }))

  return {
    docs,
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page: result.page ?? 1,
    hasNextPage: result.hasNextPage ?? false,
    hasPrevPage: result.hasPrevPage ?? false,
    canCreate,
    scope,
    workspaceId,
  }
}

export type CatalogKindCounts = {
  all: number
  byKind: Record<EntityKind, number>
}

/**
 * Per-kind entity counts for the kind tabs. Org-wide by default; `scope: 'mine'`
 * restricts to the caller's active workspaces. Respects the active text `query`.
 */
export async function getCatalogKindCounts(
  input: { userId?: string; query?: string; scope?: CatalogScope; workspaceId?: string } = {},
): Promise<CatalogKindCounts> {
  const payload = await getPayload({ config })
  const { query, scope = 'all', workspaceId } = input

  const zero = ENTITY_KIND_VALUES.reduce(
    (acc, k) => ({ ...acc, [k]: 0 }),
    {} as Record<EntityKind, number>,
  )

  const sessionUser = await getPayloadUserFromSession()
  if (!sessionUser) return { all: 0, byKind: zero }

  let workspaceFilter: string[] | undefined
  if (scope === 'mine') {
    const betterAuthId = sessionUser.betterAuthId ?? undefined
    const manageableIds = betterAuthId
      ? await getManageableWorkspaceIds(payload, betterAuthId)
      : []
    if (manageableIds.length === 0) return { all: 0, byKind: zero }
    workspaceFilter = manageableIds
  }

  const counts = await Promise.all(
    ENTITY_KIND_VALUES.map((kind) =>
      payload
        .count({
          collection: 'catalog-entities',
          where: buildOrgCatalogWhere({ workspaceIds: workspaceFilter, workspaceId, kind, query }),
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

  const wsOf = (v: string | { id: string } | null | undefined) =>
    v == null ? '' : typeof v === 'string' ? v : v.id
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
