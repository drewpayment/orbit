# @orbit/automation-worker

Temporal worker that runs two things on the dedicated `orbit-automations` task
queue:

1. **`schedule`-type Orbit automations** (P4.2) — the original purpose.
2. **The nightly scheduled scorecard evaluation sweep** (scorecards roadmap
   item 1) — see [Scorecard evaluation sweep](#scorecard-evaluation-sweep) below.

Both workflows are bundled from `src/workflows/index.ts`; each Temporal Schedule
action resolves its workflow by exported name.

## Automations dispatch

Each schedule automation owns a Temporal Schedule (created by the Next.js app via
`@temporalio/client`). When a schedule is due, Temporal starts the thin
`AutomationDispatchWorkflow`. The workflow's single activity,
`dispatchScheduledAutomation`, POSTs to orbit-www's existing internal route:

```
POST ${ORBIT_API_URL}/api/internal/automations/dispatch
  headers: X-API-Key: ${ORBIT_INTERNAL_API_KEY}
  body:    { "type": "schedule", "workspace": "<workspaceId>", "automationId": "<id>" }
```

All real work (loading the automation, resolving inputs, creating + executing the
run) stays in orbit-www. This worker is intentionally thin and imports no
Payload/Mongo/`server-only` code.

See `docs/plans/2026-06-27-automation-temporal-ts-worker.md` for the full design.

## Scorecard evaluation sweep

A single **global** nightly Temporal Schedule (`scorecard-evaluation:global`)
keeps scores, golden-path alignment, and report trends fresh without anyone
clicking "Evaluate now". When due, Temporal starts `ScorecardEvaluationSweepWorkflow`,
which:

1. Lists every enabled scorecard (across all workspaces) via the
   `listEnabledScorecards` activity → `GET ${ORBIT_API_URL}/api/internal/scorecards/due`.
2. Evaluates each scorecard via the `evaluateScorecard` activity →
   `POST ${ORBIT_API_URL}/api/internal/scorecards/evaluate` with body
   `{ "scorecardId": "<id>" }`, at **bounded concurrency (3)** to avoid hammering
   the app. Per-scorecard failures are caught and collected — one bad scorecard
   never aborts the sweep.
3. Returns `{ total, succeeded, failed: [{ scorecardId, error }] }` so the
   Temporal UI shows exactly what happened.

Score snapshots and entity-score recompute need no extra calls: the `/evaluate`
route's `runScorecardEvaluation` already recomputes workspace scores and captures
snapshots (a 30-min throttle collapses multiple scorecards per workspace into one
snapshot set per sweep).

**The worker self-manages this Schedule.** At startup, BEFORE it begins polling,
it idempotently creates-or-converges `scorecard-evaluation:global` (create, catch
`ScheduleAlreadyRunning`, update) honoring the cron + disabled env. This ensure is
**fatal on failure** (fail-closed): a worker that can't guarantee its Schedule
exits nonzero and the deployment restarts it. There is no app-side bootstrap and
no manual step.

Activity error semantics mirror the dispatch activity: a 4xx is terminal
(non-retryable `ApplicationFailure` — Temporal stops), any other non-2xx
(5xx/network) is retryable, and env is validated at call time with actionable
messages.

See `docs/plans/2026-07-02-scheduled-scorecard-evaluation.md` for the full design.

## Environment variables

| Var | Default | Read in | Purpose |
|---|---|---|---|
| `TEMPORAL_ADDRESS` | `localhost:7233` | worker | Temporal frontend `host:port`. |
| `TEMPORAL_NAMESPACE` | `default` | worker | Temporal namespace to poll. |
| `ORBIT_API_URL` | — (**required**) | activities | Base URL of the Next.js app, e.g. `http://localhost:3000`. |
| `ORBIT_INTERNAL_API_KEY` | — (**required**) | activities | Key for the internal routes (`X-API-Key`). |
| `SCORECARD_EVAL_CRON` | `0 5 * * *` | worker (schedule ensure) | Sweep cadence (05:00 UTC nightly by default). |
| `SCORECARD_EVAL_DISABLED` | unset | worker (schedule ensure) | `1`/`true` ⇒ the sweep Schedule is converged to **paused** (also pauses an existing one); unset/`0` ⇒ unpaused. |
| `AUTOMATION_SCHEDULE_TZ` | `UTC` | worker (schedule ensure) | Timezone for the sweep cron. Shared with the automations convention. |

The activities throw a clear error if `ORBIT_API_URL` or `ORBIT_INTERNAL_API_KEY`
is missing, and throw on any non-2xx response so Temporal retries
(`maximumAttempts: 5`).

## Running (Phase 1, local)

This worker is a **separate long-running process** from `bun run dev`, run against
the real local Temporal from `make dev`.

```bash
# 1. Bring up Temporal (+ UI on :8080) and the rest of the stack
make dev

# 2. In one terminal: the Next.js app
cd orbit-www && bun run dev

# 3. In another terminal: this worker
cd orbit-www && bun run worker:automations
```

A clean startup logs the sweep-schedule ensure (id + cron + paused state), then
the task queue, namespace, and Temporal address. The worker drains in-flight work
on `SIGINT`/`SIGTERM` and exits non-zero on a fatal error (including a
schedule-ensure failure at startup).

## Typecheck

```bash
cd orbit-www && bunx tsc --noEmit -p services/automation-worker/tsconfig.json
```
