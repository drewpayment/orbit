# Code Context

## Files Retrieved

1. `orbit-www/src/lib/scorecards/snapshots.ts` (lines 130-325) — snapshot throttling, fixed row limits, aggregation reads, and append-only writes.
2. `orbit-www/src/collections/scorecards/ScoreSnapshots.ts` (lines 26-107) — collection fields, access controls, and current non-unique indexes.
3. `orbit-www/src/app/api/internal/scorecards/capture-snapshots/route.ts` (lines 1-45) — internal capture API accepts only `workspaceId` and `force`.
4. `orbit-www/services/automation-worker/src/activities/scorecard-sweep.ts` (lines 80-142) — evaluation and forced workspace-capture HTTP activities.
5. `orbit-www/services/automation-worker/src/workflows/scorecard-sweep.ts` (lines 28-87) — per-workspace sequencing and final snapshot invocation.
6. `orbit-www/src/app/(frontend)/scorecards/reports/actions.ts` (lines 40-220, 300-441) — report membership resolution, multi-workspace queries, and fixed ceilings.
7. `orbit-www/src/app/(frontend)/scorecards/reports/page.tsx` (lines 18-25) — report entry point lacks explicit workspace selection.
8. `orbit-www/src/components/features/scorecards/reports/ReportView.tsx` (lines 50-73) — refresh calls only pass window length.
9. `orbit-www/src/lib/scorecards/snapshots.test.ts` (lines 149-348) — current fake Payload and orchestration coverage.
10. `orbit-www/services/automation-worker/src/activities/scorecard-sweep.test.ts` (lines 110-185) — capture activity request coverage.
11. `orbit-www/src/lib/scorecards/evaluate.ts` (lines 570-588, 900-921, 1125-1213) — reusable page-loop pattern.
12. `orbit-www/src/app/api/internal/scorecards/due/route.ts` (lines 30-52) — reusable paginated route pattern.
13. `orbit-www/src/scripts/backfill-catalog-graph.ts` (lines 30-117) — repeated `page`/`hasNextPage` traversal.
14. `orbit-www/src/lib/workspace.ts` (lines 8-36) — existing current-workspace helper, although it currently selects the first active membership rather than an explicit user selection.

## Key Code

### Snapshot writes are not retry-idempotent

`captureScoreSnapshots` accepts only a throttle override:

```ts
opts: { force?: boolean } = {}
```

`orbit-www/src/lib/scorecards/snapshots.ts:165-169`

The workflow’s final activity always sends `force: true`:

```ts
body: JSON.stringify({ workspaceId: input.workspaceId, force: true })
```

`orbit-www/services/automation-worker/src/activities/scorecard-sweep.ts:123-133`

Temporal retries that activity up to five times:

```ts
const { captureWorkspaceSnapshots } = proxyActivities({
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 5 },
})
```

`orbit-www/services/automation-worker/src/workflows/scorecard-sweep.ts:42-45`

Therefore, if the POST commits rows but its response is lost, a retry bypasses throttling and appends another complete or partial batch. The collection has no capture identity or uniqueness constraint; its indexes are only lookup indexes (`ScoreSnapshots.ts:100-105`).

### Final workspace consistency is otherwise correctly coordinated

Scorecards within a workspace are evaluated sequentially with incidental capture disabled, and final capture occurs only if every evaluation succeeds:

```ts
await evaluateScorecard({ scorecardId: scorecard.id, captureSnapshots: false })
...
if (outcomes.every((outcome) => outcome.ok)) {
  await captureWorkspaceSnapshots({ workspaceId: workspace.key })
}
```

`orbit-www/services/automation-worker/src/workflows/scorecard-sweep.ts:55-74`

This is the correct consistency boundary; only final-capture retry identity is missing.

### Reports implicitly combine all memberships

The action resolves every active membership (`actions.ts:55-73`) and applies:

```ts
{ workspace: { in: workspaceIds } }
```

to overall scores, entities, teams, scorecards, snapshots, results, and scorecard score rows (`actions.ts:169-217`, `331-359`).

Consequences:

- KPIs and trends combine unrelated workspaces.
- Team names are keyed only by entity ID in one shared map.
- The caller cannot request or display which workspace is being reported.
- `getScorecardReport` accepts only `windowDays` (`actions.ts:159`).
- Initial and refresh callers pass only the window (`reports/page.tsx:20-22`, `ReportView.tsx:56`).

### Silent ceilings

`PAGE_LIMIT = 5000` appears in:

- `orbit-www/src/lib/scorecards/snapshots.ts:139`
- `orbit-www/src/app/(frontend)/scorecards/reports/actions.ts:47`

Snapshot capture truncates:

- workspace overall scores: `snapshots.ts:191-199`
- each scorecard’s score rows and rule results: `snapshots.ts:228-252`

Reports truncate:

- overall scores: `actions.ts:169-176`
- evaluated score rows: `actions.ts:222-238`
- rules/results/score rows: `actions.ts:331-359`

Additional fixed ceilings exist for scorecards and teams (`snapshots.ts:217`, `270`; report `actions.ts:184-199`). These are also silent, though less likely to be reached.

The trend query’s 1,000-row limit (`actions.ts:132, 202-211`) is semantically different: it deliberately bounds a time series, but can still omit part of a 90-day window at frequent capture rates.

## Architecture

1. Temporal lists due scorecards and groups them by workspace.
2. Each workspace’s scorecards are evaluated serially with snapshot side effects suppressed.
3. Temporal calls the internal capture endpoint once after successful completion.
4. The endpoint invokes `captureScoreSnapshots`, which reads current projections and appends workspace, scorecard, and team rows.
5. The report action independently reads live projections plus workspace-scope historical snapshots and aggregates them for the UI.

The capture batch currently has no durable identifier tying its rows to a Temporal workflow execution. The report action uses membership authorization as report selection, conflating “allowed workspaces” with “requested workspace.”

## Smallest Testable Fixes

### 1. Idempotent final workspace snapshots

Recommended minimal durable design:

- Add optional indexed `captureKey` to `ScoreSnapshots`.
- Make a unique `snapshotKey` per output row, derived from:
  - capture key
  - workspace
  - scope
  - scorecard/team identifier where applicable.
- Extend capture options/API/activity with `captureKey`.
- In the workflow, derive a deterministic key from Temporal workflow identity plus workspace, and pass it to the final activity.
- Upsert/find-before-create each expected row by `snapshotKey`; a retry completes missing rows without duplicating completed rows.
- Keep ordinary throttled evaluation captures compatible by generating no key or a fresh capture key.

A single “batch already exists” check is insufficient: the first attempt may write the workspace row and fail halfway through. Per-row keys permit safe partial retry. A code-only find-before-create without a unique index remains race-prone if activity attempts overlap.

Tests:

- `snapshots.test.ts`: repeat the same keyed forced capture and assert no duplicates.
- Simulate failure after the workspace row, retry with the same key, and assert the full batch exists exactly once.
- Assert a different capture key creates a new batch.
- Route test: validate/forward `captureKey`.
- Activity test: assert `captureKey` is posted.
- Workflow test: assert stable key use for the final workspace call.

### 2. Explicit workspace report scoping

Change the action to:

```ts
getScorecardReport(workspaceId: string, windowDays: number)
```

Then query one active membership for `(userId, workspaceId)` and return empty/forbidden if absent. Replace every `{ in: workspaceIds }` with `{ equals: workspaceId }`.

Update the report page, refresh component, and dashboard caller to supply the selected/current workspace explicitly. Do not use `getCurrentWorkspaceId()` unchanged as the security check: `lib/workspace.ts:18-35` simply returns the first active membership and does not validate a caller-supplied workspace.

Tests:

- Member of workspaces A and B requesting A sees only A.
- Requesting a non-member workspace returns the chosen empty/authorization result.
- Every report collection query includes `workspace = requestedWorkspace`.
- Refresh preserves the same workspace ID.

### 3. Remove silent row ceilings

Reuse the established loop:

```ts
for (let page = 1; ; page++) {
  const result = await payload.find({ ..., limit: PAGE_SIZE, page })
  rows.push(...result.docs)
  if (!result.hasNextPage) break
}
```

Existing examples:

- `orbit-www/src/lib/scorecards/evaluate.ts:576-588`
- `orbit-www/src/app/api/internal/scorecards/due/route.ts:30-52`
- `orbit-www/src/scripts/backfill-catalog-graph.ts:30-117`

Smallest implementation is a local typed `findAllPages` helper in each affected module, or one shared Payload pagination helper if both modules can share typing cleanly. Replace aggregation-critical fixed-limit reads first. Preserve intentional result caps only after documenting why truncation is valid.

Tests should configure fake Payload with a small page size and multiple pages, then prove:

- workspace snapshot counts all pages;
- scorecard pass rate includes later pages;
- report KPIs and sections include later pages;
- no loop occurs after `hasNextPage === false`.

## Start Here

Open `orbit-www/src/lib/scorecards/snapshots.ts:139-325` first. It contains both critical defects: unbounded logical datasets truncated to 5,000 and forced append-only writes without a retry identity.

## Review Findings

- **Blocker:** `orbit-www/services/automation-worker/src/activities/scorecard-sweep.ts:123-133` plus `workflows/scorecard-sweep.ts:42-45` — forced POST is retried but has no idempotency key.
- **Blocker:** `orbit-www/src/app/(frontend)/scorecards/reports/actions.ts:159-217` — authorization memberships are incorrectly used as an aggregate report scope.
- **Blocker:** `orbit-www/src/lib/scorecards/snapshots.ts:139,191-252` and report `actions.ts:47,169-238,331-359` — aggregation inputs silently truncate at 5,000.
- **Risk:** Per-row uniqueness needs careful handling of legacy rows and Mongo null behavior; use a populated scalar `snapshotKey`, not a compound unique index containing nullable scorecard/team fields.
- **Risk:** The working tree already contains many unrelated modifications. This reconnaissance made no edits and did not stage anything.