'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import type { CatalogEntity, EntityScore, Scorecard, ScorecardRule, ScorecardRuleResult, ScoreSnapshot } from '@/payload-types'
import {
  buildLevelDistribution,
  type LevelBucket,
  type LevelDef,
} from '@/components/features/scorecards/scorecard-ui'
import {
  computeOrgKpis,
  computeScoreBands,
  computeGroupBreakdown,
  computeRuleFailures,
  buildTrendSeries,
  type OrgKpis,
  type ScoreBand,
  type GroupBreakdown,
  type GroupScoreRow,
  type RuleFailure,
  type RuleResultRow,
  type SnapshotPoint,
  type TrendPoint,
} from '@/lib/scorecards/reporting'

/**
 * Scorecard Reports & Insights — the report server action (WP3,
 * docs/plans/2026-07-01-scorecard-reports.md). Loads live `entity-scores` /
 * `scorecard-rule-results` / `score-snapshots` rows scoped to the current
 * user's workspaces and shapes them into the full report payload using the
 * pure aggregation functions from `lib/scorecards/reporting.ts` (WP2). All
 * math lives there; this module is I/O + shaping only.
 */

type Payload = Awaited<ReturnType<typeof getPayload>>

const PAGE_LIMIT = 5000

/** Extract a relationship's id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/**
 * Resolve the workspace IDs the given user actively belongs to — the tenant
 * boundary for every report query below. Mirrors `scorecards/actions.ts`'s
 * `getMemberWorkspaceIds`.
 */
async function getMemberWorkspaceIds(payload: Payload, userId: string): Promise<string[]> {
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

  return memberships.docs.map((m) => (typeof m.workspace === 'string' ? m.workspace : m.workspace.id))
}

/** Normalise a scorecard's ladder into clean {@link LevelDef}s, lowest rank first. */
function scorecardLevels(scorecard: Scorecard): LevelDef[] {
  return (scorecard.levels ?? [])
    .map((l) => ({ name: l.name, rank: l.rank, color: l.color }))
    .sort((a, b) => a.rank - b.rank)
}

// ---------------------------------------------------------------------------
// getScorecardReport
// ---------------------------------------------------------------------------

export interface ScorecardReportKpis extends OrgKpis {
  /** Enabled scorecards in the user's workspaces. */
  activeScorecards: number
}

export interface FailingEntity {
  id: string
  name: string
  score: number
}

export interface ScorecardSectionReport {
  scorecardId: string
  scorecardName: string
  levels: LevelDef[]
  distribution: LevelBucket[]
  unranked: number
  entitiesEvaluated: number
  /** Passing / total rule-result rows — feeds `RollupSummary`'s ratio bar. */
  passed: number
  total: number
  topFailingRules: RuleFailure[]
  topFailingEntities: FailingEntity[]
}

export interface ScorecardReport {
  generatedAt: string
  windowDays: number
  kpis: ScorecardReportKpis
  bands: ScoreBand[]
  trend: TrendPoint[]
  byTeam: GroupBreakdown[]
  byKind: GroupBreakdown[]
  scorecards: ScorecardSectionReport[]
}

const RULE_FAILURES_PER_SCORECARD = 5
const FAILING_ENTITIES_PER_SCORECARD = 10
const TREND_SNAPSHOT_LIMIT = 1000
const TEAM_UNASSIGNED_LABEL = 'Unassigned'

/** An all-zeros report for an unauthenticated caller or a workspace-less user. */
function emptyReport(windowDays: number): ScorecardReport {
  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    kpis: { avgScore: 0, avgAlignment: 0, scoredCount: 0, entityTotal: 0, activeScorecards: 0 },
    bands: computeScoreBands([]),
    trend: [],
    byTeam: [],
    byKind: [],
    scorecards: [],
  }
}

/**
 * The full scorecard report payload: org KPIs, score-band distribution, the
 * windowed trend series, team/kind breakdowns, and a per-enabled-scorecard
 * section (level distribution, top failing rules, top failing entities).
 * Tenancy mirrors `scorecards/actions.ts`: the session user is resolved
 * server-side and every query is bounded to their active workspace
 * memberships — `userId` is never trusted from the client.
 */
export async function getScorecardReport(windowDays: number): Promise<ScorecardReport> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return emptyReport(windowDays)

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return emptyReport(windowDays)

  const [overallRes, entityTotalRes, teamsRes, enabledScorecardsRes, trendRes] = await Promise.all([
    // scope=overall rows carry the entity's blended score + golden-path
    // alignment; depth 1 resolves `entity` for name/kind/owner (owner stays
    // an id string at this depth — team names are joined via `teamsRes` below).
    payload.find({
      collection: 'entity-scores',
      where: { and: [{ workspace: { in: workspaceIds } }, { scope: { equals: 'overall' } }] },
      limit: PAGE_LIMIT,
      depth: 1,
      overrideAccess: true,
    }),
    // Count-only query (limit 0) for the workspace's total catalog entities —
    // the "x of y" denominator on the Entities scored KPI tile.
    payload.find({
      collection: 'catalog-entities',
      where: { workspace: { in: workspaceIds } },
      limit: 0,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'catalog-entities',
      where: { and: [{ workspace: { in: workspaceIds } }, { kind: { equals: 'team' } }] },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'scorecards',
      where: { and: [{ workspace: { in: workspaceIds } }, { enabled: { equals: true } }] },
      sort: 'name',
      limit: 200,
      depth: 0,
      overrideAccess: true,
    }),
    // Workspace-scope snapshots feed the trend line; fetched over a fixed
    // lookback (comfortably beyond the widest 90-day segment) and windowed
    // client-side-equivalent below via `buildTrendSeries`.
    payload.find({
      collection: 'score-snapshots',
      where: { and: [{ workspace: { in: workspaceIds } }, { scope: { equals: 'workspace' } }] },
      sort: '-capturedAt',
      limit: TREND_SNAPSHOT_LIMIT,
      depth: 0,
      overrideAccess: true,
    }),
  ])

  const overallRows = overallRes.docs as EntityScore[]
  const teamNameById = new Map((teamsRes.docs as CatalogEntity[]).map((t) => [t.id, t.name]))
  const enabledScorecards = enabledScorecardsRes.docs as Scorecard[]

  // --- org KPIs + score bands -----------------------------------------------
  const overallScores = overallRows.map((r) => r.score)
  const alignments = overallRows
    .map((r) => r.goldenPathAlignment)
    .filter((v): v is number => typeof v === 'number')
  const kpis: ScorecardReportKpis = {
    ...computeOrgKpis(overallScores, alignments, entityTotalRes.totalDocs),
    activeScorecards: enabledScorecards.length,
  }
  const bands = computeScoreBands(overallScores)

  // --- team / kind breakdowns -------------------------------------------------
  const teamRows: GroupScoreRow[] = []
  const kindRows: GroupScoreRow[] = []
  for (const row of overallRows) {
    const entity = row.entity
    if (typeof entity !== 'object' || entity === null) continue
    // A missing golden-path alignment (not every entity has an applicable
    // golden path) defaults to 0 for the group average rather than being
    // dropped — the entity still counts toward the group's `count`.
    const alignment = typeof row.goldenPathAlignment === 'number' ? row.goldenPathAlignment : 0
    const ownerId = relId(entity.owner)
    const teamName = ownerId ? (teamNameById.get(ownerId) ?? TEAM_UNASSIGNED_LABEL) : TEAM_UNASSIGNED_LABEL

    teamRows.push({
      group: teamName,
      entityId: entity.id,
      entityName: entity.name,
      score: row.score,
      alignment,
    })
    kindRows.push({
      group: entity.kind,
      entityId: entity.id,
      entityName: entity.name,
      score: row.score,
      alignment,
    })
  }
  const byTeam = computeGroupBreakdown(teamRows)
  const byKind = computeGroupBreakdown(kindRows)

  // --- trend series ----------------------------------------------------------
  const snapshotPoints: SnapshotPoint[] = (trendRes.docs as ScoreSnapshot[]).map((s) => ({
    capturedAt: s.capturedAt,
    avgScore: s.avgScore,
  }))
  const trend = buildTrendSeries(snapshotPoints, windowDays, new Date())

  // --- per-scorecard sections --------------------------------------------------
  const scorecards = await buildScorecardSections(payload, workspaceIds, enabledScorecards)

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    kpis,
    bands,
    trend,
    byTeam,
    byKind,
    scorecards,
  }
}

/**
 * One {@link ScorecardSectionReport} per enabled scorecard. Batches
 * rules/results/scores fetches across every scorecard (rather than N+1
 * round-trips per scorecard), mirroring `listScorecards`' batching in
 * `scorecards/actions.ts`.
 */
async function buildScorecardSections(
  payload: Payload,
  workspaceIds: string[],
  scorecards: Scorecard[],
): Promise<ScorecardSectionReport[]> {
  if (scorecards.length === 0) return []
  const scorecardIds = scorecards.map((s) => s.id)

  const [rulesRes, resultsRes, scoreRowsRes] = await Promise.all([
    payload.find({
      collection: 'scorecard-rules',
      where: { scorecard: { in: scorecardIds } },
      limit: PAGE_LIMIT,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'scorecard-rule-results',
      where: { and: [{ workspace: { in: workspaceIds } }, { scorecard: { in: scorecardIds } }] },
      limit: PAGE_LIMIT,
      depth: 0,
      overrideAccess: true,
    }),
    // depth 1 to resolve `entity` for the top-failing-entities links (name).
    payload.find({
      collection: 'entity-scores',
      where: {
        and: [
          { workspace: { in: workspaceIds } },
          { scope: { equals: 'scorecard' } },
          { scorecard: { in: scorecardIds } },
        ],
      },
      limit: PAGE_LIMIT,
      depth: 1,
      overrideAccess: true,
    }),
  ])

  const ruleTitleById = new Map((rulesRes.docs as ScorecardRule[]).map((r) => [r.id, r.title]))

  const resultsByScorecard = new Map<string, ScorecardRuleResult[]>()
  for (const res of resultsRes.docs as ScorecardRuleResult[]) {
    const scId = relId(res.scorecard)
    if (!scId) continue
    const list = resultsByScorecard.get(scId) ?? []
    list.push(res)
    resultsByScorecard.set(scId, list)
  }

  const scoreRowsByScorecard = new Map<string, EntityScore[]>()
  for (const row of scoreRowsRes.docs as EntityScore[]) {
    const scId = relId(row.scorecard)
    if (!scId) continue
    const list = scoreRowsByScorecard.get(scId) ?? []
    list.push(row)
    scoreRowsByScorecard.set(scId, list)
  }

  return scorecards.map((scorecard) => {
    const levels = scorecardLevels(scorecard)
    const scoreRows = scoreRowsByScorecard.get(scorecard.id) ?? []
    const results = resultsByScorecard.get(scorecard.id) ?? []

    // Level distribution reuses the entity-scores rows' already-materialised
    // levelName/levelRank (written by `recomputeWorkspaceScores`) rather than
    // re-deriving from rule pass sets — same approach as
    // `lib/scorecards/snapshots.ts`'s `aggregateScorecardRows`.
    const entityLevels: Array<LevelDef | null> = scoreRows.map((r) =>
      r.levelName ? { name: r.levelName, rank: r.levelRank ?? 0 } : null,
    )
    const distribution = buildLevelDistribution(levels, entityLevels)

    const ruleResultRows: RuleResultRow[] = results.map((r) => ({
      ruleId: relId(r.rule) ?? '',
      title: ruleTitleById.get(relId(r.rule) ?? '') ?? 'Unknown rule',
      passed: r.passed,
    }))
    const topFailingRules = computeRuleFailures(ruleResultRows).slice(0, RULE_FAILURES_PER_SCORECARD)

    const topFailingEntities: FailingEntity[] = [...scoreRows]
      .sort((a, b) => a.score - b.score)
      .slice(0, FAILING_ENTITIES_PER_SCORECARD)
      .map((r) => {
        const entity = r.entity
        return {
          id: typeof entity === 'object' && entity ? entity.id : (relId(entity) ?? ''),
          name: typeof entity === 'object' && entity ? entity.name : 'Unknown entity',
          score: r.score,
        }
      })
      .filter((e) => e.id !== '')

    return {
      scorecardId: scorecard.id,
      scorecardName: scorecard.name,
      levels,
      distribution: distribution.buckets,
      unranked: distribution.unranked,
      entitiesEvaluated: scoreRows.length,
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      topFailingRules,
      topFailingEntities,
    }
  })
}
