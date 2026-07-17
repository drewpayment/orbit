'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import type {
  CatalogEntity,
  EntityScore,
  Scorecard,
  ScorecardRule,
  ScorecardRuleResult,
  ScoreSnapshot,
} from '@/payload-types'
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
  rankFailingEntities,
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

const PAGE_SIZE = 500

/** Extract a relationship's id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

async function findAllDocs<T>(
  payload: Payload,
  args: Record<string, unknown>,
): Promise<T[]> {
  const docs: T[] = []
  for (let page = 1; ; page++) {
    const result = await payload.find({ ...args, limit: PAGE_SIZE, page } as never)
    docs.push(...(result.docs as T[]))
    if (!result.hasNextPage) return docs
  }
}

async function hasActiveMembership(
  payload: Payload,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: userId } },
        { workspace: { equals: workspaceId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return membership.docs.length > 0
}

export interface ReportWorkspaceOption {
  id: string
  name: string
}

/** Workspaces the current user may select as the explicit report boundary. */
export async function getReportWorkspaceOptions(): Promise<ReportWorkspaceOption[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []
  const memberships = await findAllDocs<Record<string, unknown>>(payload, {
    collection: 'workspace-members',
    where: { and: [{ user: { equals: uid } }, { status: { equals: 'active' } }] },
    depth: 1,
    overrideAccess: true,
  })
  return memberships
    .map((membership) => membership.workspace)
    .filter(
      (workspace): workspace is { id: string; name: string } =>
        typeof workspace === 'object' && workspace !== null && 'id' in workspace && 'name' in workspace,
    )
    .map((workspace) => ({ id: String(workspace.id), name: String(workspace.name) }))
    .sort((left, right) => left.name.localeCompare(right.name))
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
  /** The single explicit workspace represented by every row in this report. */
  workspaceId: string
  /** When the underlying projections/snapshots were last evaluated. */
  dataAsOf: string | null
  /** When this report payload was fetched. */
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
const TEAM_UNASSIGNED_LABEL = 'Unassigned'

/** An all-zeros report for an unauthenticated caller or a workspace-less user. */
function emptyReport(workspaceId: string, windowDays: number): ScorecardReport {
  return {
    workspaceId,
    dataAsOf: null,
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
 * The caller selects one workspace, but the session is resolved server-side
 * and active membership is verified before any report data is queried.
 */
export async function getScorecardReport(
  workspaceId: string,
  windowDays: number,
): Promise<ScorecardReport> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid || !workspaceId) return emptyReport(workspaceId, windowDays)
  if (!(await hasActiveMembership(payload, uid, workspaceId))) {
    return emptyReport(workspaceId, windowDays)
  }
  const reportNow = new Date()
  const boundedWindowDays = Math.max(0, Math.min(windowDays, 365))
  const trendCutoff = new Date(
    reportNow.getTime() - boundedWindowDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  const [overallRows, entityTotalRes, teams, enabledScorecards, trendSnapshots] =
    await Promise.all([
      // scope=overall rows carry the entity's blended score + golden-path
      // alignment; depth 1 resolves `entity` for name/kind/owner.
      findAllDocs<EntityScore>(payload, {
        collection: 'entity-scores',
        where: {
          and: [{ workspace: { equals: workspaceId } }, { scope: { equals: 'overall' } }],
        },
        depth: 1,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'catalog-entities',
        where: { workspace: { equals: workspaceId } },
        limit: 0,
        depth: 0,
        overrideAccess: true,
      }),
      findAllDocs<CatalogEntity>(payload, {
        collection: 'catalog-entities',
        where: {
          and: [{ workspace: { equals: workspaceId } }, { kind: { equals: 'team' } }],
        },
        depth: 0,
        overrideAccess: true,
      }),
      findAllDocs<Scorecard>(payload, {
        collection: 'scorecards',
        where: {
          and: [{ workspace: { equals: workspaceId } }, { enabled: { equals: true } }],
        },
        sort: 'name',
        depth: 0,
        overrideAccess: true,
      }),
      findAllDocs<ScoreSnapshot>(payload, {
        collection: 'score-snapshots',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { scope: { equals: 'workspace' } },
            { capturedAt: { greater_than_equal: trendCutoff } },
          ],
        },
        sort: '-capturedAt',
        depth: 0,
        overrideAccess: true,
      }),
    ])

  const teamNameById = new Map(teams.map((team) => [team.id, team.name]))

  const enabledScorecardIds = enabledScorecards.map((scorecard) => scorecard.id)
  const evaluatedEntityIds = new Set<string>()
  if (enabledScorecardIds.length > 0) {
    const evaluatedRows = await findAllDocs<EntityScore>(payload, {
      collection: 'entity-scores',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { scope: { equals: 'scorecard' } },
          { scorecard: { in: enabledScorecardIds } },
        ],
      },
      depth: 0,
      overrideAccess: true,
    })
    for (const row of evaluatedRows) {
      const entityId = relId(row.entity)
      if (entityId) evaluatedEntityIds.add(entityId)
    }
  }

  // --- org KPIs + score bands -----------------------------------------------
  const overallScores = overallRows.map((r) => r.score)
  const alignments = overallRows
    .map((r) => r.goldenPathAlignment)
    .filter((v): v is number => typeof v === 'number')
  const kpis: ScorecardReportKpis = {
    ...computeOrgKpis(overallScores, alignments, entityTotalRes.totalDocs, evaluatedEntityIds.size),
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
    const teamName = ownerId
      ? (teamNameById.get(ownerId) ?? TEAM_UNASSIGNED_LABEL)
      : TEAM_UNASSIGNED_LABEL

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
  const snapshotPoints: SnapshotPoint[] = trendSnapshots.map((snapshot) => ({
    capturedAt: snapshot.capturedAt,
    avgScore: snapshot.avgScore,
  }))
  const trend = buildTrendSeries(snapshotPoints, boundedWindowDays, reportNow)

  const dataTimes = [
    ...overallRows.map((row) => row.evaluatedAt),
    ...trendSnapshots.map((snapshot) => snapshot.capturedAt),
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
  const dataAsOf = dataTimes.length > 0 ? new Date(Math.max(...dataTimes)).toISOString() : null

  // --- per-scorecard sections --------------------------------------------------
  const scorecards = await buildScorecardSections(payload, workspaceId, enabledScorecards)

  return {
    workspaceId,
    dataAsOf,
    generatedAt: reportNow.toISOString(),
    windowDays: boundedWindowDays,
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
  workspaceId: string,
  scorecards: Scorecard[],
): Promise<ScorecardSectionReport[]> {
  if (scorecards.length === 0) return []
  const scorecardIds = scorecards.map((s) => s.id)

  const [rules, results, scoreRows] = await Promise.all([
    findAllDocs<ScorecardRule>(payload, {
      collection: 'scorecard-rules',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { scorecard: { in: scorecardIds } },
        ],
      },
      depth: 0,
      overrideAccess: true,
    }),
    findAllDocs<ScorecardRuleResult>(payload, {
      collection: 'scorecard-rule-results',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { scorecard: { in: scorecardIds } },
        ],
      },
      depth: 0,
      overrideAccess: true,
    }),
    // depth 1 to resolve `entity` for the top-failing-entities links (name).
    findAllDocs<EntityScore>(payload, {
      collection: 'entity-scores',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { scope: { equals: 'scorecard' } },
          { scorecard: { in: scorecardIds } },
        ],
      },
      depth: 1,
      overrideAccess: true,
    }),
  ])

  const ruleTitleById = new Map(rules.map((rule) => [rule.id, rule.title]))

  const resultsByScorecard = new Map<string, ScorecardRuleResult[]>()
  for (const res of results) {
    const scId = relId(res.scorecard)
    if (!scId) continue
    const list = resultsByScorecard.get(scId) ?? []
    list.push(res)
    resultsByScorecard.set(scId, list)
  }

  const scoreRowsByScorecard = new Map<string, EntityScore[]>()
  for (const row of scoreRows) {
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
    const topFailingRules = computeRuleFailures(ruleResultRows).slice(
      0,
      RULE_FAILURES_PER_SCORECARD,
    )

    const failingEntityIds = new Set(
      results
        .filter((result) => !result.passed)
        .map((result) => relId(result.entity))
        .filter((id): id is string => Boolean(id)),
    )

    const topFailingEntities: FailingEntity[] = rankFailingEntities(
      scoreRows
        .map((r) => {
          const entity = r.entity
          return {
            id: typeof entity === 'object' && entity ? entity.id : (relId(entity) ?? ''),
            name: typeof entity === 'object' && entity ? entity.name : 'Unknown entity',
            score: r.score,
          }
        })
        .filter((entity) => entity.id !== ''),
      failingEntityIds,
      FAILING_ENTITIES_PER_SCORECARD,
    )

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
