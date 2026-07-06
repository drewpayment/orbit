# Scheduled Scorecard Evaluation

**Date:** 2026-07-02
**Status:** Shipped (PR #60)
**Roadmap:** `2026-07-02-scorecards-roadmap.md` item 1.
**Depends on:** P4.2 automation Temporal worker (`docs/plans/2026-06-27-automation-temporal-ts-worker.md`),
scorecard internal routes (P2 / PR #56 / PR #59).

## Product goal

Scores, golden-path alignment, and report trends must stay fresh **without a human
clicking "Evaluate now"**. A nightly Temporal-scheduled sweep evaluates every enabled
scorecard in every workspace, which (via the existing `runScorecardEvaluation`
pipeline) also recomputes entity scores and appends score snapshots — so the reports
trend chart accrues history automatically.

## Design

### Shape: one global Temporal Schedule + a sweep workflow on the existing worker

- **No new deployable.** The sweep workflow and its activities live in the existing
  `orbit-www/services/automation-worker/` package and run on the existing
  `orbit-automations` task queue. The existing Dockerfile / k8s deployment /CI image
  pick the code up automatically.
- **One global Schedule**, id `scorecard-evaluation:global`, cron default `0 5 * * *`
  (05:00 UTC nightly), overridable via `SCORECARD_EVAL_CRON`. Timezone follows the
  same convention as automations (`AUTOMATION_SCHEDULE_TZ`, default UTC).
- **The worker manages its own schedule**: at startup, before polling, the worker
  idempotently creates-or-converges the Schedule (same converge pattern as
  `ensureAutomationSchedule` — create, catch `ScheduleAlreadyRunning`, update).
  Setting `SCORECARD_EVAL_DISABLED=1` converges the Schedule to paused (and pauses
  an existing one); unset/0 unpauses. This keeps the schedule lifecycle entirely
  inside the worker — no app-side bootstrap, no manual step.
  - Requires adding `@temporalio/client` to the worker package (schedule client uses
    `Connection`, distinct from the worker's `NativeConnection`).
  - Ensure-failure at startup is FATAL (fail-closed, mirroring the automations
    invariant): a worker that can't guarantee its schedule exits nonzero and the
    deployment restarts it.

### Sweep workflow (`ScorecardEvaluationSweepWorkflow`)

Deterministic sandbox rules apply (no Node APIs, type-only activity imports).

1. Activity `listEnabledScorecards()` → GET
   `${ORBIT_API_URL}/api/internal/scorecards/due` (X-API-Key) → returns
   `{ scorecards: [{ id, workspaceId }] }`.
2. For each scorecard, activity `evaluateScorecard({ scorecardId })` → POST the
   existing `/api/internal/scorecards/evaluate`. Runs with **bounded concurrency
   (3)** to avoid hammering the app; per-item failures are caught and collected —
   one bad scorecard must not abort the sweep.
3. Returns a summary `{ total, succeeded, failed: [{ scorecardId, error }] }` so the
   Temporal UI shows exactly what happened.

Activity retry/timeout mirrors `dispatchScheduledAutomation`: `startToCloseTimeout`
generous for evaluate (5m — a big workspace evaluation is slow), 5 attempts, 4xx →
`ApplicationFailure.nonRetryable`, 5xx/network → retryable Error.

Snapshots & recompute need no extra calls: `runScorecardEvaluation` already invokes
`recomputeWorkspaceScores` + `captureScoreSnapshots` (30-min throttle collapses
multiple scorecards per workspace into one snapshot set per sweep).

### New internal route: `GET /api/internal/scorecards/due`

`orbit-www/src/app/api/internal/scorecards/due/route.ts`, X-API-Key
(`validateInternalApiKey`), mirrors the existing internal scorecards routes.
Returns every enabled scorecard: `payload.find({ collection: 'scorecards', where:
{ enabled: { equals: true } }, depth: 0, limit: 0/paginated })` → `{ scorecards:
[{ id, workspaceId }] }` (workspace normalized to a string id). No request body; no
tenant filter — this is the machine sweep surface, same trust level as `evaluate`.

### Contract additions (`services/automation-worker/src/shared.ts`)

- `SCORECARD_SWEEP_WORKFLOW = 'ScorecardEvaluationSweepWorkflow'`
- `SCORECARD_SWEEP_SCHEDULE_ID = 'scorecard-evaluation:global'`
- `DEFAULT_SCORECARD_EVAL_CRON = '0 5 * * *'`
- `interface ScorecardSweepResult { total: number; succeeded: number; failed: { scorecardId: string; error: string }[] }`
- Module stays free of Temporal/Node imports (sandbox-importable invariant).

### Worker wiring

- New `src/workflows/index.ts` barrel re-exporting `AutomationDispatchWorkflow` and
  `ScorecardEvaluationSweepWorkflow`; `worker.ts` `workflowsPath` points at the
  barrel (Schedule actions resolve workflows by exported name — existing
  automation schedules are unaffected).
- Activities object merges dispatch + scorecard-sweep activities.
- Startup order: connect → ensure schedule (fatal on failure) → create worker → run.

## Files

| file | change |
|---|---|
| `orbit-www/services/automation-worker/src/shared.ts` | add sweep contract consts/types |
| `orbit-www/services/automation-worker/src/workflows/scorecard-sweep.ts` | NEW — sweep workflow |
| `orbit-www/services/automation-worker/src/workflows/index.ts` | NEW — barrel for workflowsPath |
| `orbit-www/services/automation-worker/src/activities/scorecard-sweep.ts` | NEW — list + evaluate activities |
| `orbit-www/services/automation-worker/src/activities/scorecard-sweep.test.ts` | NEW — activity tests (mirror `dispatch.test.ts`) |
| `orbit-www/services/automation-worker/src/schedule.ts` | NEW — `ensureScorecardSweepSchedule` (client-side ensure) |
| `orbit-www/services/automation-worker/src/schedule.test.ts` | NEW — ensure/converge/pause tests |
| `orbit-www/services/automation-worker/src/worker.ts` | workflowsPath → barrel; register activities; startup ensure |
| `orbit-www/services/automation-worker/package.json` | add `@temporalio/client` |
| `orbit-www/src/app/api/internal/scorecards/due/route.ts` | NEW — enabled-scorecards listing |
| `orbit-www/src/app/api/internal/scorecards/due/route.test.ts` | NEW — route tests (auth, shape, pagination) |
| `orbit-www/services/automation-worker/README.md` | document sweep + env vars |
| `infrastructure/k8s/automations-worker/deployment.yaml` | (optional) SCORECARD_EVAL_CRON env passthrough |

## Env

| var | default | meaning |
|---|---|---|
| `SCORECARD_EVAL_CRON` | `0 5 * * *` | sweep cadence |
| `SCORECARD_EVAL_DISABLED` | unset | `1`/`true` ⇒ schedule converged to paused |
| `ORBIT_API_URL`, `ORBIT_INTERNAL_API_KEY`, `AUTOMATION_SCHEDULE_TZ` | existing | reused |

## User Acceptance Criteria

- **UAC-1:** Worker startup idempotently ensures Schedule `scorecard-evaluation:global`
  (create → converge-on-exists), honoring cron + disabled env; ensure failure is fatal.
- **UAC-2:** The sweep workflow lists enabled scorecards via `/due` and POSTs
  `/evaluate` per scorecard with bounded concurrency (3); a failing scorecard does not
  abort the sweep; the run result reports `{ total, succeeded, failed[] }`.
- **UAC-3:** `/api/internal/scorecards/due` rejects missing/bad X-API-Key, returns all
  enabled scorecards (and only enabled) with string workspace ids, across pagination.
- **UAC-4:** Activity error semantics match the dispatch activity: 4xx nonretryable,
  5xx/network retryable; env validated at call time with actionable messages.
- **UAC-5:** Existing automation dispatch behavior is unchanged (its tests still pass;
  schedule action workflow names still resolve via the new barrel).
- **UAC-6:** All new logic is unit-tested (vitest, TDD); `tsc --noEmit` clean for
  touched files; no UI changes (so no agent-browser pass required).

## Verification

- `cd orbit-www && pnpm exec vitest run services/automation-worker src/app/api/internal`
  (plus the existing scorecards suites for regression:
  `pnpm exec vitest run src/lib/scorecards`)
- `cd orbit-www && pnpm exec tsc --noEmit` (touched files clean; repo has known
  pre-existing errors elsewhere)
- QA review pass against UAC-1..6 before merge.
