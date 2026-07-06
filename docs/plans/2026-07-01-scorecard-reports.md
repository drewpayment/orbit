# Scorecard Reports & Insights

**Status:** Shipped (PR #59)
**Depends on:** Entity Scores & Golden Paths (PR #56) — this branch is stacked on
`feat/entity-scores-golden-paths`. See `2026-07-01-entity-scores-and-golden-paths.md`.

## Product definition

The scorecards area is good at *authoring* (rules, levels, evaluation) but has no
*reporting*: an engineering leader can't answer "are we getting better?", "which teams
are behind?", or "which standard is failing the org?" without clicking through every
scorecard. This feature adds the measurement layer — the equivalent of Cortex's
Eng-Intelligence reports, Port's scorecard dashboards, and Backstage Soundcheck's
tech-health page:

- **Executives** get a single org-health view: average score, golden-path adoption,
  distribution, and the trend line ("up and to the right or not").
- **Engineering leaders** get rollups by team / kind / tier, worst offenders, and
  per-scorecard rule insights (which checks fail most, who's failing them) to direct
  remediation.
- **Real-time**: the report always reflects the latest evaluation — a visible
  last-updated stamp, manual refresh, and gentle auto-refresh; running "Evaluate now"
  shows up on the report within one refresh cycle.

Out of scope (follow-ups): scheduled email digests, CSV export, per-team drill-down
pages, initiative burndown (Initiatives collections exist but have no UI yet).

## Design

### New collection: `score-snapshots` (`orbit-www/src/collections/scorecards/ScoreSnapshots.ts`)

Append-only history enabling trends (current `entity-scores` rows are upserted in
place, so they hold only the latest state). Machine-written like
`scorecard-rule-results` (create/update/delete `() => false`), `workspaceScopedRead`.

| field | type | notes |
|---|---|---|
| `workspace` | rel, required, index | tenant boundary |
| `scope` | select `workspace` \| `scorecard` \| `team`, required, index | aggregate granularity |
| `scorecard` | rel → scorecards, index | set when scope=scorecard |
| `team` | rel → catalog-entities, index | set when scope=team (kind='team' row) |
| `avgScore` | number, required | mean overall score (workspace/team scope) or mean scorecard score (scorecard scope) |
| `avgAlignment` | number | mean golden-path alignment (workspace/team scope) |
| `entityCount` | number, required | entities behind the average |
| `passRate` | number | scorecard scope: passing results / total results |
| `levelDistribution` | json | scorecard scope: `{ [levelName]: count, unranked: count }` |
| `capturedAt` | date, required, index | |

Indexes: `[workspace, scope, capturedAt]`, `[scorecard, capturedAt]`.

Writer: `captureScoreSnapshots(payload, workspaceId, { force? })` in
`lib/scorecards/snapshots.ts` — computes aggregates from live `entity-scores` /
`scorecard-rule-results` rows and appends one workspace row + one row per enabled
scorecard + one row per owning team. **Throttle:** skip (no-op, return skipped:true)
when the newest workspace-scope snapshot is younger than 30 minutes, unless `force`.
Called fire-and-forget at the end of `runScorecardEvaluation` and
`recomputeWorkspaceScores` (a snapshot failure must never fail an evaluation), and
exposed via `/api/internal/scorecards/capture-snapshots` (X-API-Key, accepts
`force`) mirroring the existing internal routes.

### Aggregation library (`orbit-www/src/lib/scorecards/reporting.ts` — pure, framework-light)

No Payload imports; fully unit-tested (`reporting.test.ts`). Functions over plain
row shapes:

- `computeOrgKpis(overallScores, alignments, entityTotal)` → `{ avgScore, avgAlignment, scoredCount, entityTotal }`
- `computeScoreBands(overallScores)` → counts for bands 0–25 / 26–50 / 51–75 / 76–100
- `computeGroupBreakdown(rows: {group, score, alignment}[])` → per-group `{ count, avgScore, avgAlignment, worst: {name, score} }`, sorted ascending by avgScore (worst first)
- `computeRuleFailures(results: {ruleId, title, passed}[])` → ranked `{ ruleId, title, failCount, failPct }`
- `buildTrendSeries(snapshots: {capturedAt, avgScore}[], windowDays)` → sorted `[ { t, v } ]` clipped to window
- `formatRelativeTime(date, now)` for the last-updated stamp

### Server actions (`orbit-www/src/app/(frontend)/scorecards/reports/actions.ts`)

`getScorecardReport(windowDays)` — one action returning the whole report payload
(KPIs, bands, per-scorecard sections with level distribution + rule failures +
failing entities (top 10, id+name+score), team/kind breakdowns, trend series,
`generatedAt`). Tenancy identical to existing scorecards actions
(`getMemberWorkspaceIds`, session user resolved server-side, no client-supplied
identity). Reuses existing helpers (`buildLevelDistribution`, `computeEntityLevel`)
where they fit.

### UI (`orbit-www/src/app/(frontend)/scorecards/reports/page.tsx` + `components/features/scorecards/reports/`)

Linked from the `/scorecards` header ("Reports"). Layout, top to bottom:

1. **KPI row** — 4 stat tiles: Avg overall score (big number + tone color), Avg
   golden-path alignment, Entities scored (x of y), Active scorecards.
2. **Trend card** — dependency-free SVG line chart (`TrendChart.tsx`,
   framework-light path-building in `chart-paths.ts` with unit tests): org avg
   score over 7/30/90-day window (segmented control). Graceful states: 0 points →
   "No history yet — snapshots appear after evaluations", 1 point → dot + caption.
3. **Score distribution** — horizontal band bars (reuse Progress styling patterns).
4. **Breakdown tables** — "By team" and "By kind" tabs: count, avg score (tone
   colored), avg alignment, worst entity (links to `/catalog/[id]`). Sorted worst
   first; client-side sort toggle on avg score.
5. **Per-scorecard sections** — for each enabled scorecard: level distribution bar
   (reuse `RollupSummary` pieces), top-5 failing rules (fail count + fail %), top
   failing entities with links; header links to `/scorecards/[id]`.
6. **Freshness** — "Updated <relative time>" + Refresh button + auto-refresh every
   60s while the tab is visible (clear the interval on hidden/unmount).

Empty workspace (no entities / no scorecards / no snapshots): every section renders
a friendly empty state; the page never errors.

No new chart dependency: charts are small SVG components with the data-shaping
extracted into framework-light tested modules (recharts can replace them later).

## User Acceptance Criteria

- **UAC-1 (Reports home):** `/scorecards/reports` exists, is linked from the
  `/scorecards` page header, and renders the 4 KPI tiles from live data. A
  workspace with no data renders empty states without errors.
- **UAC-2 (Distributions):** the page shows the org score-band distribution and a
  per-scorecard level distribution (per level + unranked), visually (bars).
- **UAC-3 (Breakdowns):** team and kind breakdown tables show count, avg score,
  avg alignment, and worst entity linking to its catalog page; default order is
  worst-first and avg-score sort can be toggled.
- **UAC-4 (Rule insights):** each enabled scorecard section ranks its top failing
  rules with fail count and fail %, and lists top failing entities with links.
- **UAC-5 (Trends):** `score-snapshots` is append-only, machine-written,
  workspace-scoped; evaluation/recompute append snapshots (30-min throttle,
  `force` override); the trend chart renders the windowed series and both empty
  and single-point states gracefully.
- **UAC-6 (Real-time):** the report shows "Updated <time>", a working Refresh
  button, and auto-refreshes ≤ 60s while visible; after "Evaluate now" on a
  scorecard, the report reflects the new results within one refresh.
- **UAC-7 (Tenancy):** every report query is bounded to the user's active
  workspace memberships; snapshots reject direct user writes; workspace members
  (non-admin) can view reports.
- **UAC-8 (Quality):** aggregation + chart-path logic live in pure framework-light
  modules with vitest coverage; all feature suites pass; `tsc --noEmit` is clean
  for touched files.
- **UAC-9 (QA sign-off):** a live agent-browser pass validates UAC-1..6 against a
  running dev server, including an Evaluate-now → report-refresh round trip.

## Work packages

| WP | Scope | Owner files |
|---|---|---|
| WP1 | ScoreSnapshots collection + snapshots lib + evaluate/recompute integration + internal route | `collections/scorecards/ScoreSnapshots.ts`, `lib/scorecards/snapshots.ts` (+test), `lib/scorecards/evaluate.ts` (hook-in only), `app/api/internal/scorecards/capture-snapshots/route.ts`, `payload.config.ts`, types regen |
| WP2 | Reporting aggregation lib + chart-path lib (pure) + tests | `lib/scorecards/reporting.ts` (+test), `components/features/scorecards/reports/chart-paths.ts` (+test) |
| WP3 | Report action + page + components + header link + refresh loop | `app/(frontend)/scorecards/reports/**`, `components/features/scorecards/reports/**`, `app/(frontend)/scorecards/page.tsx` (link only) |

## Verification

- `cd orbit-www && bunx vitest run src/lib/scorecards src/lib/catalog src/components/features/scorecards src/components/features/catalog`
- `cd orbit-www && bunx tsc --noEmit` (touched files clean; repo has known
  pre-existing errors elsewhere)
- Workflow verify loop (tests+tsc) and UAC audit loop until green, then live
  agent-browser QA (UAC-9) with fix-and-retest loop.
