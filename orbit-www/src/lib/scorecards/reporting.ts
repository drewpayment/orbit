/**
 * Report aggregation math (Scorecard Reports & Insights,
 * docs/plans/2026-07-01-scorecard-reports.md, WP2).
 *
 * PURE functions only — no Payload imports here. The report server action
 * (`app/(frontend)/scorecards/reports/actions.ts`, WP3) loads live
 * entity-scores / scorecard-rule-results / score-snapshots rows and calls
 * into these formulas to shape the report payload. Keeping the math pure
 * makes it exhaustively unit-testable without a Payload instance, and
 * mirrors the pattern in `lib/scorecards/scoring.ts`.
 *
 * `buildTrendSeries` and `formatRelativeTime` both take `now` as a
 * parameter rather than reading the clock internally — that keeps every
 * function in this module deterministic and easy to test; the caller
 * (a server action) supplies the real wall-clock time.
 */

/** Rounds a list of numbers to their mean, 0 for an empty list (not NaN). */
function mean(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

// --- computeOrgKpis -----------------------------------------------------------

export interface OrgKpis {
  avgScore: number
  avgAlignment: number
  scoredCount: number
  entityTotal: number
}

/**
 * Org-level KPI row: mean overall score and mean golden-path alignment
 * (both over scored entities only), how many entities carry a score, and
 * the workspace entity total (scored + unscored). A workspace with no
 * scored entities yet has nothing to average -> 0s, not NaN, so the KPI
 * tiles render cleanly on an empty workspace.
 */
export function computeOrgKpis(
  overallScores: number[],
  alignments: number[],
  entityTotal: number,
  evaluatedCount: number = overallScores.length,
): OrgKpis {
  return {
    avgScore: mean(overallScores),
    avgAlignment: mean(alignments),
    scoredCount: evaluatedCount,
    entityTotal,
  }
}

// --- computeScoreBands ---------------------------------------------------------

export interface ScoreBand {
  label: string
  min: number
  max: number
  count: number
}

const SCORE_BAND_DEFS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: '0-25', min: 0, max: 25 },
  { label: '26-50', min: 26, max: 50 },
  { label: '51-75', min: 51, max: 75 },
  { label: '76-100', min: 76, max: 100 },
]

/**
 * Distribution of overall scores into four fixed bands (0-25 / 26-50 /
 * 51-75 / 76-100), in that order, for the org score-distribution bars. A
 * `computeOverallScore` result is always 0-100 in practice, but out-of-range
 * input is clamped into the nearest edge band rather than silently dropped,
 * so this stays defensive against bad callers.
 */
export function computeScoreBands(overallScores: number[]): ScoreBand[] {
  const bands = SCORE_BAND_DEFS.map((def) => ({ ...def, count: 0 }))
  for (const raw of overallScores) {
    const score = Math.min(100, Math.max(0, raw))
    const band = bands.find((b) => score >= b.min && score <= b.max) ?? bands[bands.length - 1]
    band.count++
  }
  return bands
}

// --- computeGroupBreakdown ------------------------------------------------------

export interface GroupScoreRow {
  group: string
  entityId: string
  entityName: string
  score: number
  alignment: number
}

export interface GroupBreakdown {
  group: string
  count: number
  avgScore: number
  avgAlignment: number
  worst: { id: string; name: string; score: number }
}

/**
 * Per-group rollup (team or kind), sorted ascending by avgScore so the
 * worst-performing group is first — that's the actionable order for an
 * engineering leader triaging where to focus. `worst` is the single
 * lowest-scoring entity within the group; the first occurrence wins on a
 * tie, keeping the result stable/deterministic for identical input order.
 */
export function computeGroupBreakdown(rows: GroupScoreRow[]): GroupBreakdown[] {
  const byGroup = new Map<string, GroupScoreRow[]>()
  for (const row of rows) {
    const list = byGroup.get(row.group)
    if (list) list.push(row)
    else byGroup.set(row.group, [row])
  }

  const breakdowns: GroupBreakdown[] = []
  for (const [group, groupRows] of byGroup) {
    let worst = groupRows[0]
    for (const row of groupRows) {
      if (row.score < worst.score) worst = row
    }
    breakdowns.push({
      group,
      count: groupRows.length,
      avgScore: mean(groupRows.map((r) => r.score)),
      avgAlignment: mean(groupRows.map((r) => r.alignment)),
      worst: { id: worst.entityId, name: worst.entityName, score: worst.score },
    })
  }

  return breakdowns.sort((a, b) => a.avgScore - b.avgScore)
}

// --- computeRuleFailures ---------------------------------------------------------

export interface RuleResultRow {
  ruleId: string
  title: string
  passed: boolean
}

export interface RuleFailure {
  ruleId: string
  title: string
  failCount: number
  failPct: number
}

/**
 * Per-rule failure ranking across every evaluated entity: fail count and
 * fail % of all evaluations for that rule, ranked worst (most failures)
 * first — ties break alphabetically by title for a stable, readable order.
 * Rules with zero failures are omitted; this ranks *failures*, and a
 * passing rule has nothing to remediate.
 */
export function computeRuleFailures(results: RuleResultRow[]): RuleFailure[] {
  const byRule = new Map<string, { title: string; total: number; failCount: number }>()
  for (const r of results) {
    const entry = byRule.get(r.ruleId)
    if (entry) {
      entry.total++
      if (!r.passed) entry.failCount++
    } else {
      byRule.set(r.ruleId, { title: r.title, total: 1, failCount: r.passed ? 0 : 1 })
    }
  }

  const failures: RuleFailure[] = []
  for (const [ruleId, entry] of byRule) {
    if (entry.failCount === 0) continue
    failures.push({
      ruleId,
      title: entry.title,
      failCount: entry.failCount,
      failPct: Math.round((100 * entry.failCount) / entry.total),
    })
  }

  return failures.sort((a, b) => b.failCount - a.failCount || a.title.localeCompare(b.title))
}

export interface FailingEntityRow {
  id: string
  name: string
  score: number
}

/** Rank only entities with a current failed rule; a low baseline alone is not a failure. */
export function rankFailingEntities(
  rows: FailingEntityRow[],
  failingEntityIds: ReadonlySet<string>,
  limit: number,
): FailingEntityRow[] {
  return rows
    .filter((row) => failingEntityIds.has(row.id))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
}

// --- buildTrendSeries -------------------------------------------------------------

export interface SnapshotPoint {
  capturedAt: string | Date
  avgScore: number
}

export interface TrendPoint {
  t: number
  v: number
}

/**
 * Time-windowed trend series for the org-score line chart: snapshots
 * sorted ascending by capture time and clipped to the trailing
 * `windowDays` relative to `now`. Snapshots with an unparsable `capturedAt`
 * or a timestamp after `now` (clock skew / bad data) are dropped rather
 * than plotted.
 */
export function buildTrendSeries(
  snapshots: SnapshotPoint[],
  windowDays: number,
  now: Date | number,
): TrendPoint[] {
  const nowMs = now instanceof Date ? now.getTime() : now
  const windowMs = Math.max(0, windowDays) * 24 * 60 * 60 * 1000
  const cutoff = nowMs - windowMs

  return snapshots
    .map((s) => ({
      t: s.capturedAt instanceof Date ? s.capturedAt.getTime() : new Date(s.capturedAt).getTime(),
      v: s.avgScore,
    }))
    .filter((p) => Number.isFinite(p.t) && p.t >= cutoff && p.t <= nowMs)
    .sort((a, b) => a.t - b.t)
}

// --- formatRelativeTime -------------------------------------------------------------

/**
 * Compact relative-time label for the report's "Updated <time>" freshness
 * stamp (e.g. "5m ago", "just now", falling back to a locale date past a
 * week) — mirrors `components/features/actions/action-ui.ts`'s
 * `formatRelativeTime`, but takes `now` as a parameter instead of reading
 * the clock, so it's pure/deterministic like the rest of this module.
 */
export function formatRelativeTime(
  date: string | Date | null | undefined,
  now: Date | number,
): string {
  if (!date) return '—'
  const target = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(target.getTime())) return '—'

  const nowMs = now instanceof Date ? now.getTime() : now
  const diffSec = Math.floor((nowMs - target.getTime()) / 1000)
  // Future timestamps (clock skew) read as "just now" rather than negative.
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return target.toLocaleDateString()
}
