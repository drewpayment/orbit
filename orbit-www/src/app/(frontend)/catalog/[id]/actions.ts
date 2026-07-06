'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import type { CatalogEntity, CatalogRelation, EntityScore } from '@/payload-types'
import { resolveEntityType } from '@/lib/catalog/entity-types'
import type { EntityKind } from '@/collections/catalog/constants'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canManageEntity, canDeleteEntity } from '@/lib/catalog/entity-authz'

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
  /** Whether the caller may edit this entity (workspace member or platform admin). */
  canManage: boolean
  /** Whether the caller may delete this entity (manual + workspace owner/admin or admin). */
  canDelete: boolean
  /** Provenance source type ('manual' = human-authored; anything else = projected). */
  sourceType: string
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

  // Explicit ORG-WIDE read: any authenticated user can view any entity (the
  // catalog is the discovery surface). We gate on the session above and read
  // with overrideAccess rather than leaning on collection access to filter.
  let entity: CatalogEntity
  try {
    entity = (await payload.findByID({
      collection: 'catalog-entities',
      id,
      // depth 2 populates `owner` (a team entity) and `workspace`.
      depth: 2,
      overrideAccess: true,
    })) as CatalogEntity
  } catch {
    // findByID throws when the row is missing.
    return null
  }

  if (!entity) return null

  // Relations touching this entity in either direction. depth 1 populates the
  // `from`/`to` entities so the UI can render neighbour names and links. Each
  // row carries its id + `source.type`, so the UI can offer removal on manual ones.
  const relationsRes = await payload.find({
    collection: 'catalog-relations',
    where: {
      or: [{ from: { equals: id } }, { to: { equals: id } }],
    },
    depth: 1,
    limit: 200,
    overrideAccess: true,
  })

  const docs = await findLinkedDocs(payload, entity, user)

  const isAdmin = isPlatformAdmin(user)
  const betterAuthId = user.betterAuthId ?? undefined
  const workspaceId =
    entity.workspace ? (typeof entity.workspace === 'string' ? entity.workspace : entity.workspace.id) : null
  const sourceType = entity.source?.type ?? 'manual'

  const [canManage, canDelete] = await Promise.all([
    canManageEntity(payload, betterAuthId, isAdmin, { workspaceId }),
    canDeleteEntity(payload, betterAuthId, isAdmin, { workspaceId, sourceType }),
  ])

  return {
    entity,
    relations: relationsRes.docs as CatalogRelation[],
    docs,
    canManage,
    canDelete,
    sourceType,
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

// ---------------------------------------------------------------------------
// getEntityScoreBreakdown — overall score, per-scorecard scores, golden path
// ---------------------------------------------------------------------------

export interface EntityScoreBreakdown {
  /** The `scope='overall'` entity-scores row, or null before it's ever been computed. */
  overall: {
    score: number
    baseValue: number | null
    goldenPathAlignment: number | null
  } | null
  /** Per-scorecard numeric score (`scope='scorecard'`), keyed by scorecard id. */
  byScorecard: Record<string, number>
  /** True when no scorecard applies yet — the overall score is a pure baseline inheritance. */
  baselineOnly: boolean
  /** The entity type's golden-path narrative, for the alignment meter's explanation. */
  goldenPathSummary: string | null
}

const EMPTY_SCORE_BREAKDOWN: EntityScoreBreakdown = {
  overall: null,
  byScorecard: {},
  baselineOnly: true,
  goldenPathSummary: null,
}

/**
 * Score breakdown for one catalog entity: the overall `entity-scores` row
 * (score/baseValue/goldenPathAlignment), per-scorecard numeric scores, and
 * the entity type's golden-path summary — everything `EntityScorecardsTab`
 * needs beyond the per-rule level/pass-ratio breakdown already served by
 * `getEntityScoreSummary` (scorecards/actions.ts). Self-contained: resolves
 * the entity's kind/workspace itself (one extra `findByID`) so the tab
 * doesn't need the detail page to plumb it through as a prop (Entity Scores
 * & Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 */
export async function getEntityScoreBreakdown(entityId: string): Promise<EntityScoreBreakdown> {
  const user = await getPayloadUserFromSession()
  if (!user) return EMPTY_SCORE_BREAKDOWN

  const payload = await getPayload({ config })

  let entity: CatalogEntity
  try {
    entity = (await payload.findByID({
      collection: 'catalog-entities',
      id: entityId,
      depth: 0,
      user,
    })) as CatalogEntity
  } catch {
    return EMPTY_SCORE_BREAKDOWN
  }
  if (!entity) return EMPTY_SCORE_BREAKDOWN

  const workspaceId =
    typeof entity.workspace === 'string' ? entity.workspace : (entity.workspace?.id ?? '')

  const [scoresResult, entityType] = await Promise.all([
    payload.find({
      collection: 'entity-scores',
      where: { entity: { equals: entityId } },
      limit: 200,
      depth: 0,
      user,
    }),
    resolveEntityType(payload, workspaceId, entity.kind as EntityKind),
  ])

  let overall: EntityScoreBreakdown['overall'] = null
  const byScorecard: Record<string, number> = {}
  for (const row of scoresResult.docs as EntityScore[]) {
    if (row.scope === 'overall') {
      overall = {
        score: row.score,
        baseValue: row.baseValue ?? null,
        goldenPathAlignment: row.goldenPathAlignment ?? null,
      }
    } else if (row.scope === 'scorecard' && row.scorecard) {
      const scorecardId = typeof row.scorecard === 'string' ? row.scorecard : row.scorecard.id
      byScorecard[scorecardId] = row.score
    }
  }

  // No persisted overall row yet (this workspace has never run a recompute):
  // materialize the entity type's inherited baseline on the fly so the score
  // the UI promises ("every entity has a score") exists before the first
  // evaluation, exactly as `recomputeWorkspaceScores` would seed it.
  if (!overall) {
    overall = {
      score: entityType.baseValue,
      baseValue: entityType.baseValue,
      goldenPathAlignment: null,
    }
  }

  return {
    overall,
    byScorecard,
    baselineOnly: Object.keys(byScorecard).length === 0,
    goldenPathSummary: entityType.goldenPath.summary,
  }
}
