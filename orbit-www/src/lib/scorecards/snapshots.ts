import type { Payload } from 'payload'
import type { CatalogEntity, EntityScore, Scorecard, ScorecardRuleResult, ScoreSnapshot } from '@/payload-types'
import { buildLevelDistribution, type LevelDef } from '@/components/features/scorecards/scorecard-ui'

/**
 * Score history snapshots (Scorecard Reports & Insights,
 * docs/plans/2026-07-01-scorecard-reports.md, WP1).
 *
 * `entity-scores` is upserted in place — it only ever holds the LATEST state,
 * so it can't answer "are we getting better?" This module appends a row to
 * `score-snapshots` per capture, one per scope (workspace / scorecard / team),
 * giving the reports UI a trend line. The aggregate math is kept in pure,
 * Payload-free helpers below (`aggregateOverallRows`, `aggregateScorecardRows`,
 * `isThrottled`) so it's fully unit-testable; `captureScoreSnapshots` is the
 * thin Payload orchestration that reads live `entity-scores` /
 * `scorecard-rule-results` rows and writes the snapshot rows.
 */

// --- pure aggregate math ------------------------------------------------------

/** Mean of a list of numbers, or `null` when the list is empty (never NaN). */
export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Minimal shape of an `entity-scores` `scope: 'overall'` row this module needs. */
export interface OverallScoreRow {
  score: number
  goldenPathAlignment?: number | null
}

export interface OverallAggregate {
  avgScore: number
  avgAlignment: number | null
  entityCount: number
}

/**
 * Aggregate a set of `scope: 'overall'` entity-scores rows into a workspace-
 * or team-scope snapshot: mean score, mean alignment (over rows that carry
 * one — golden-path alignment is only ever set on overall rows, but a defensive
 * filter costs nothing), and the entity count behind the average. `null` when
 * there is nothing to aggregate — the caller skips writing a row for an empty
 * scope (e.g. a team that owns no entities yet).
 */
export function aggregateOverallRows(rows: OverallScoreRow[]): OverallAggregate | null {
  if (rows.length === 0) return null
  const avgScore = Math.round(average(rows.map((r) => r.score)) as number)
  const alignments = rows
    .map((r) => r.goldenPathAlignment)
    .filter((v): v is number => typeof v === 'number')
  const avgAlignment = alignments.length > 0 ? Math.round(average(alignments) as number) : null
  return { avgScore, avgAlignment, entityCount: rows.length }
}

/** Minimal shape of an `entity-scores` `scope: 'scorecard'` row this module needs. */
export interface ScorecardScoreRow {
  score: number
  levelName?: string | null
  levelRank?: number | null
}

/** Minimal shape of a `scorecard-rule-results` row this module needs. */
export interface RuleResultRow {
  passed: boolean
}

export interface ScorecardAggregate {
  avgScore: number
  entityCount: number
  /** Passing / total rule results, in [0,1]; `null` when there are no results yet. */
  passRate: number | null
  /** `{ [levelName]: count, unranked: count }`. */
  levelDistribution: Record<string, number>
}

/**
 * Bucket already-computed per-entity levels (as stored on entity-scores rows —
 * this never re-derives a level from rules) into the `{ [levelName]: count,
 * unranked: count }` shape the snapshot's `levelDistribution` field stores.
 */
export function levelDistributionToJSON(
  levels: LevelDef[],
  entityLevels: Array<LevelDef | null>,
): Record<string, number> {
  const dist = buildLevelDistribution(levels, entityLevels)
  const json: Record<string, number> = {}
  for (const bucket of dist.buckets) json[bucket.name] = bucket.count
  json.unranked = dist.unranked
  return json
}

/**
 * Aggregate a scorecard's `scope: 'scorecard'` entity-scores rows plus its
 * scorecard-rule-results into a scorecard-scope snapshot. `levels` is the
 * scorecard's ladder (for bucketing the level distribution); each score row's
 * `levelName`/`levelRank` (already computed by `recomputeWorkspaceScores`) is
 * used as-is, not re-derived from rule results. `null` when the scorecard has
 * no scored entities yet.
 */
export function aggregateScorecardRows(
  scoreRows: ScorecardScoreRow[],
  ruleResults: RuleResultRow[],
  levels: LevelDef[],
): ScorecardAggregate | null {
  if (scoreRows.length === 0) return null
  const avgScore = Math.round(average(scoreRows.map((r) => r.score)) as number)
  const passRate =
    ruleResults.length > 0 ? ruleResults.filter((r) => r.passed).length / ruleResults.length : null
  const entityLevels: Array<LevelDef | null> = scoreRows.map((r) =>
    r.levelName ? { name: r.levelName, rank: r.levelRank ?? 0 } : null,
  )
  return {
    avgScore,
    entityCount: scoreRows.length,
    passRate,
    levelDistribution: levelDistributionToJSON(levels, entityLevels),
  }
}

/** Snapshots are captured at most once per this window (per workspace), unless `force`. */
export const SNAPSHOT_THROTTLE_MS = 30 * 60 * 1000

/**
 * True when `newestCapturedAt` (the newest `workspace`-scope snapshot's
 * `capturedAt`) is younger than `SNAPSHOT_THROTTLE_MS` relative to `now`.
 * No prior snapshot (`null`/`undefined`) is never throttled — the first
 * capture always runs.
 */
export function isThrottled(newestCapturedAt: string | null | undefined, now: Date): boolean {
  if (!newestCapturedAt) return false
  const age = now.getTime() - new Date(newestCapturedAt).getTime()
  return age < SNAPSHOT_THROTTLE_MS
}

// --- orchestration -------------------------------------------------------------

const PAGE_SIZE = 500

async function findAllDocs<T>(payload: Payload, args: Record<string, unknown>): Promise<T[]> {
  const docs: T[] = []
  for (let page = 1; ; page++) {
    const result = await payload.find({ ...args, limit: PAGE_SIZE, page } as never)
    docs.push(...(result.docs as T[]))
    if (!result.hasNextPage) return docs
  }
}

/** Normalise a relationship end (id string or populated doc) to its id, or null when unset. */
function relIdOf(v: string | { id: string } | null | undefined): string | null {
  if (v == null) return null
  return typeof v === 'string' ? v : v.id
}

export interface CaptureScoreSnapshotsResult {
  /** True when the throttle skipped this capture (no rows written). */
  skipped: boolean
  /** Number of score-snapshots rows materialised (created or refreshed). */
  rowsWritten: number
}

type SnapshotWriteData = Record<string, unknown> & {
  workspace: string
  scope: 'workspace' | 'scorecard' | 'team'
  avgScore: number
  entityCount: number
  capturedAt: string
}

async function writeSnapshotRow(
  payload: Payload,
  data: SnapshotWriteData,
  captureKey: string | undefined,
  scopeKey: string,
): Promise<void> {
  const snapshotKey = captureKey ? `${captureKey}:${data.workspace}:${scopeKey}` : undefined
  const keyedData = {
    ...data,
    ...(captureKey ? { captureKey, snapshotKey } : {}),
  }

  if (!snapshotKey) {
    await payload.create({
      collection: 'score-snapshots',
      data: keyedData,
      overrideAccess: true,
    })
    return
  }

  const findExisting = () =>
    payload.find({
      collection: 'score-snapshots',
      where: {
        and: [
          { workspace: { equals: data.workspace } },
          { snapshotKey: { equals: snapshotKey } },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  const existing = await findExisting()
  if (existing.docs.length > 0) {
    await payload.update({
      collection: 'score-snapshots',
      id: existing.docs[0].id,
      data: keyedData,
      overrideAccess: true,
    })
    return
  }

  try {
    await payload.create({
      collection: 'score-snapshots',
      data: keyedData,
      overrideAccess: true,
    })
  } catch (error) {
    const raced = await findExisting()
    if (raced.docs.length === 0) throw error
    await payload.update({
      collection: 'score-snapshots',
      id: raced.docs[0].id,
      data: keyedData,
      overrideAccess: true,
    })
  }
}

/**
 * Append one score-snapshots row per scope for `workspaceId`: one
 * `workspace`-scope rollup, one `scorecard`-scope row per enabled scorecard,
 * and one `team`-scope row per owning team (catalog-entities kind='team')
 * that owns at least one scored entity. Reads live `entity-scores` /
 * `scorecard-rule-results` rows — never recomputes scores itself.
 *
 * Throttled to once per `SNAPSHOT_THROTTLE_MS`, keyed on the newest
 * `workspace`-scope snapshot's `capturedAt`, unless `opts.force` is set.
 * Always uses `overrideAccess` — the collection forbids direct user writes.
 */
export async function captureScoreSnapshots(
  payload: Payload,
  workspaceId: string,
  opts: { force?: boolean; captureKey?: string } = {},
): Promise<CaptureScoreSnapshotsResult> {
  const now = new Date()
  const captureKey = opts.captureKey?.trim() || undefined

  if (!opts.force) {
    const newest = await payload.find({
      collection: 'score-snapshots',
      where: { and: [{ workspace: { equals: workspaceId } }, { scope: { equals: 'workspace' } }] },
      sort: '-capturedAt',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const newestRow = newest.docs[0] as ScoreSnapshot | undefined
    if (isThrottled(newestRow?.capturedAt, now)) {
      return { skipped: true, rowsWritten: 0 }
    }
  }

  let capturedAt = now.toISOString()
  if (captureKey) {
    const existingCapture = await payload.find({
      collection: 'score-snapshots',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { captureKey: { equals: captureKey } },
        ],
      },
      sort: 'capturedAt',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const existingCapturedAt = (existingCapture.docs[0] as ScoreSnapshot | undefined)?.capturedAt
    if (existingCapturedAt) capturedAt = existingCapturedAt
  }
  let rowsWritten = 0

  // --- workspace scope: every `overall` entity-scores row in the workspace ---
  // Depth 1 so each row's `entity` populates far enough to read `entity.owner`
  // (the team relationship) for the team-scope grouping below.
  const overallRows = await findAllDocs<EntityScore>(payload, {
    collection: 'entity-scores',
    where: { and: [{ workspace: { equals: workspaceId } }, { scope: { equals: 'overall' } }] },
    depth: 1,
    overrideAccess: true,
  })

  const workspaceAgg = aggregateOverallRows(
    overallRows.map((r) => ({ score: r.score, goldenPathAlignment: r.goldenPathAlignment })),
  )
  if (workspaceAgg) {
    await writeSnapshotRow(
      payload,
      {
        workspace: workspaceId,
        scope: 'workspace',
        avgScore: workspaceAgg.avgScore,
        avgAlignment: workspaceAgg.avgAlignment,
        entityCount: workspaceAgg.entityCount,
        capturedAt,
      },
      captureKey,
      'workspace',
    )
    rowsWritten++
  }

  // --- scorecard scope: one row per enabled scorecard ------------------------
  const scorecards = await findAllDocs<Scorecard>(payload, {
    collection: 'scorecards',
    where: { and: [{ workspace: { equals: workspaceId } }, { enabled: { equals: true } }] },
    depth: 0,
    overrideAccess: true,
  })

  for (const scorecard of scorecards) {
    const [scoreRows, ruleResults] = await Promise.all([
      findAllDocs<EntityScore>(payload, {
        collection: 'entity-scores',
        where: {
          and: [
            { workspace: { equals: workspaceId } },
            { scope: { equals: 'scorecard' } },
            { scorecard: { equals: scorecard.id } },
          ],
        },
        depth: 0,
        overrideAccess: true,
      }),
      findAllDocs<ScorecardRuleResult>(payload, {
        collection: 'scorecard-rule-results',
        where: { and: [{ workspace: { equals: workspaceId } }, { scorecard: { equals: scorecard.id } }] },
        depth: 0,
        overrideAccess: true,
      }),
    ])

    const levels: LevelDef[] = (scorecard.levels ?? []).map((l) => ({ name: l.name, rank: l.rank }))
    const agg = aggregateScorecardRows(
      scoreRows.map((r) => ({
        score: r.score,
        levelName: r.levelName,
        levelRank: r.levelRank,
      })),
      ruleResults.map((r) => ({ passed: r.passed })),
      levels,
    )
    if (!agg) continue

    await writeSnapshotRow(
      payload,
      {
        workspace: workspaceId,
        scope: 'scorecard',
        scorecard: scorecard.id,
        avgScore: agg.avgScore,
        entityCount: agg.entityCount,
        passRate: agg.passRate,
        levelDistribution: agg.levelDistribution,
        capturedAt,
      },
      captureKey,
      `scorecard:${scorecard.id}`,
    )
    rowsWritten++
  }

  // --- team scope: one row per owning team with ≥1 scored entity -------------
  const teams = await findAllDocs<CatalogEntity>(payload, {
    collection: 'catalog-entities',
    where: { and: [{ workspace: { equals: workspaceId } }, { kind: { equals: 'team' } }] },
    depth: 0,
    overrideAccess: true,
  })

  if (teams.length > 0) {
    const rowsByTeam = new Map<string, OverallScoreRow[]>()
    for (const row of overallRows) {
      const entity = row.entity
      const ownerId = typeof entity === 'object' && entity ? relIdOf(entity.owner as string | { id: string } | null) : null
      if (!ownerId) continue
      const list = rowsByTeam.get(ownerId) ?? []
      list.push({ score: row.score, goldenPathAlignment: row.goldenPathAlignment })
      rowsByTeam.set(ownerId, list)
    }

    for (const team of teams) {
      const agg = aggregateOverallRows(rowsByTeam.get(team.id) ?? [])
      if (!agg) continue

      await writeSnapshotRow(
        payload,
        {
          workspace: workspaceId,
          scope: 'team',
          team: team.id,
          avgScore: agg.avgScore,
          avgAlignment: agg.avgAlignment,
          entityCount: agg.entityCount,
          capturedAt,
        },
        captureKey,
        `team:${team.id}`,
      )
      rowsWritten++
    }
  }

  return { skipped: false, rowsWritten }
}
