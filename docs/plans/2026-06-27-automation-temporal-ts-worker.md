# Scheduled Automations via a TypeScript Temporal Worker (P4.2)

**Date:** 2026-06-27
**Branch:** claude/idp-refactor-service-catalog-g7ch9h
**Status:** IMPLEMENTED (Phase 1 + Phase 2) — built and live-verified against real Temporal on 2026-06-28; the worker is containerized and wired into `make dev` + k8s. See "Implementation status".

## Goal

Make `schedule`-type automations actually fire, using Temporal — **written in
TypeScript**, sharing the `orbit-www` toolchain/types, rather than Go. Each
schedule automation gets its **own Temporal Schedule** (Temporal owns the cron
timing); when due, Temporal starts a thin workflow whose single activity POSTs
the **existing** `/api/internal/automations/dispatch` route. No new durable-
execution system, no k8s CronJob, no reimplemented cron due-ness.

## Review decisions (locked)

1. **Fail-closed, no best-effort.** For `schedule`-type automations, Temporal is a
   hard dependency: authoring an automation **succeeds only if the Temporal Schedule
   operation succeeds**. If Temporal is unreachable, the save **fails atomically**
   with a clear "scheduling service unavailable" error — we do not save the record
   and reconcile later. The invariant is *schedule automation exists ⇔ its Temporal
   Schedule exists*. This removes the reconciler and any sync-status UI from scope.
   - **Scope:** this hard dependency applies **only to the `schedule` path**.
     Event-driven automations (drift, entity-changed) never touch Temporal and MUST
     keep saving even when Temporal is down.
2. **Worker is a workspace package inside `orbit-www`:** `orbit-www/services/automation-worker`
   (`@orbit/automation-worker`), depended on by the web app. Exposes a **client-safe
   `shared` subpath** (contract only) that Next imports, and a **worker subpath**
   (Temporal runtime) that Next never imports.
3. **Phased, tested against real Temporal** (already available via `make dev` /
   OrbStack). Phase 1 proves the loop locally (worker run by hand); Phase 2 wires it
   into `make dev`/compose + k8s.

## Why this shape (recap)

- Temporal is already self-hosted and load-bearing (templates, kafka, deployments,
  GitHub token refresh). Adding scheduling to it is incremental, not new weight.
- `@temporalio/client@^1.13.0` is **already** installed in `orbit-www` and already
  used from server actions (`src/lib/temporal/client.ts`). The client half is TS today.
- Going TS for the worker buys: one language, shared types/libs, one toolchain, and a
  path to retire the Go worker — **not** the elimination of a separate worker process
  (a Temporal Worker is always a long-running process).

## Where each piece runs

| Piece | Lives in | Runs in |
|---|---|---|
| Contract (workflow name, task queue, input type, `scheduleId()`) — **client-safe** | `services/automation-worker` → `@orbit/automation-worker/shared` | imported by both Next and the worker |
| Schedule lifecycle (create/update/pause/delete) — **client** | `orbit-www/src/lib/temporal/automation-schedules.ts` (uses `@temporalio/client`) | The Next.js process, inside automation server actions |
| `AutomationDispatchWorkflow` (thin) | `@orbit/automation-worker/worker` (workflows/) | Temporal's deterministic V8 sandbox, inside the worker process |
| `dispatchScheduledAutomation` **activity** (HTTP POST) | `@orbit/automation-worker/worker` (activities/) | The worker process (plain Node) |
| Worker entrypoint | `@orbit/automation-worker/worker` (worker.ts) | A **separate** long-running Node process / container |
| Actual work (load automation, resolve inputs, create + execute run) | `orbit-www` dispatch lib + internal route (already built) | The Next.js process |

The worker stays **thin**: its activity only does `fetch(POST /api/internal/...)`. It
does **not** import Payload/Mongo/`server-only` — all real logic stays in `orbit-www`.

```
 author schedule automation (server action, TS)
   1. insert automation record (Payload)            ── get id
   2. client.schedule.create('automation:<id>', { cronExpressions:[cron], timeZone, paused:!enabled,
        action: startWorkflow AutomationDispatchWorkflow → taskQueue 'orbit-automations', args:[{id,workspaceId}] })
   3. on schedule FAILURE → delete the record (rollback) → throw "scheduling service unavailable"
        ▼ (Temporal fires exactly when due)
 AutomationDispatchWorkflow({ automationId, workspaceId })      [worker, sandbox]
        │  proxyActivities
        ▼
 dispatchScheduledAutomation activity ── HTTP POST ─▶ /api/internal/automations/dispatch
                                                       { type:'schedule', workspace, automationId }
        ▼
 dispatchAutomationEvent (single-automation schedule path)      [orbit-www, extended]
        └─ load automation → resolveInputMapping → createAndDispatchRun(sourceAutomationId) → action run
```

## Components & files

### 1. The worker package — `orbit-www/services/automation-worker`
- `package.json`: name `@orbit/automation-worker`; deps `@temporalio/worker`,
  `@temporalio/workflow`, `@temporalio/activity` (client stays in orbit-www). Subpath
  exports:
  - `"./shared"` → `src/shared.ts` — **no Temporal runtime imports**: `AUTOMATION_DISPATCH_WORKFLOW`
    (name), `AUTOMATION_TASK_QUEUE = 'orbit-automations'`, `type AutomationDispatchInput =
    { automationId: string; workspaceId: string }`, `scheduleId(id) = `automation:${id}``.
  - `"./worker"` → `src/worker.ts` — the runtime entry (never imported by Next).
- `src/workflows/automation-dispatch.ts` — `AutomationDispatchWorkflow(input)`: thin;
  `proxyActivities({ startToCloseTimeout:'1m', retry:{maximumAttempts:5} })` →
  `dispatchScheduledAutomation(input)`. No I/O, no Payload imports, no `Date.now()`/`Math.random()`.
- `src/activities/dispatch.ts` — `dispatchScheduledAutomation({ automationId, workspaceId })`:
  POST `${ORBIT_API_URL}/api/internal/automations/dispatch` with `X-API-Key` and body
  `{ type:'schedule', workspace: workspaceId, automationId }`; throw on non-2xx so Temporal retries.
- `src/worker.ts` — `Worker.create({ connection, namespace, taskQueue: AUTOMATION_TASK_QUEUE,
  workflowsPath, activities })` + `worker.run()`. **ESM note:** orbit-www is `type:module`;
  resolve `workflowsPath` with `new URL('./workflows', import.meta.url)` / `fileURLToPath`,
  not `require.resolve`.
- `orbit-www/package.json`: add `"workspaces": ["services/*"]` (or equivalent) and depend on
  `"@orbit/automation-worker": "workspace:*"`; add script `"worker:automations"`.

> **Phase-1 task 0 (spike):** prove `@orbit/automation-worker/shared` imports cleanly from a
> Next server action under both `next dev` (Turbopack) **and** the `output:'standalone'`
> production build, and that `@temporalio/worker` is NOT pulled into the Next bundle. If the
> workspace package fights the bundler, fall back to a path-aliased dir (`@/services/...`).
> Do not build further until this is green.

### 2. Schedule lifecycle helper (client — runs in Next, **throws on failure**)
`orbit-www/src/lib/temporal/automation-schedules.ts` (reuses `getTemporalClient()`,
imports the contract from `@orbit/automation-worker/shared`):
- `ensureAutomationSchedule(automation)` — create-or-update the Schedule
  (`spec.cronExpressions=[cron]`, `spec.timeZone=AUTOMATION_SCHEDULE_TZ`, `state.paused=!enabled`,
  `action=startWorkflow(...)`). Idempotent on the deterministic `scheduleId`.
- `deleteAutomationSchedule(id)` (treat not-found as success).
- `getScheduleNextRun(id)` — `handle.describe()` → `info.nextActionTimes[0]` (the **authoritative**
  next-run for the detail page).
- **These propagate errors** (no best-effort wrapper). Callers translate a Temporal failure into
  a user-facing "scheduling service unavailable" error.

### 3. Server-action wiring — fail-closed (`src/app/(frontend)/automations/actions.ts`)
Only the `schedule` path touches Temporal. Ordering preserves the *both-or-neither* invariant:

| Automation change | Sequence |
|---|---|
| create, `event==='schedule'` | insert record → `ensureAutomationSchedule` → **on failure: delete record, throw** |
| create, `event!=='schedule'` | insert record (no Temporal) |
| update, stays `schedule` (cron/enabled changed) | `ensureAutomationSchedule` (id exists) → **on success** persist record; on failure throw, record unchanged |
| update, `schedule` → other event | persist record → `deleteAutomationSchedule` (on failure throw) |
| update, other event → `schedule` | `ensureAutomationSchedule` → on success persist record; on failure throw |
| delete automation | `deleteAutomationSchedule` → on success delete record; on failure throw |

The error surfaces through the existing `AutomationForm` toast path. Event-driven automation
authoring is **unchanged** and never blocked by Temporal.

### 4. Single-automation schedule dispatch (extend dispatcher + route)
`dispatchAutomationEvent` currently fans out to all matching automations — wrong for "run
exactly this one on its cron." Add a branch: when `event.type==='schedule'` && `event.automationId`
→ load that one automation (verify `workspace` matches, `enabled`, `trigger.event==='schedule'`),
`resolveInputMapping(automation.inputMapping, event)`, `createAndDispatchRun({ trigger:'automation',
sourceAutomationId: automation.id })`, stamp `lastTriggeredAt`. The internal route already
validates `type:'schedule'`+`workspace`; accept the optional `automationId` and pass it through.
The schedule automation's `trigger.filter` is ignored (filters narrow *events*, not schedules).

> Input mapping for schedule automations: no entity/rule context, so `{{entity.*}}`/`{{rule.*}}`
> resolve to `''`; literal values pass through (e.g. `name: 'weekly-sweep'`). Note in the UI hint.

### 5. Detail page "Next run" (resolves the timezone problem)
- **schedule** automations: read the authoritative next time from Temporal via
  `getScheduleNextRun(scheduleId)` (server component). If Temporal is unreachable at *view*
  time, degrade gracefully — show "next run unavailable (scheduling service unreachable)" — a
  read-time soft failure, distinct from the write-time hard failure.
- **event** automations: unchanged descriptive label.
- `nextCronRun` is retained only as the **client-side authoring preview** in `AutomationForm`
  (no Temporal call while typing). No tz mismatch because the detail page no longer computes it.

## Timezone
The Schedule still needs a `spec.timeZone`; v1 ships a single `AUTOMATION_SCHEDULE_TZ` (default
`'UTC'`). Because the detail page reads next-run from Temporal, the displayed time always matches
reality regardless of tz. Per-workspace tz is a follow-up.

## Deployment (Phase 2) — DONE
Mirrors `launches-worker-azure` (the existing Node/TS Temporal worker). The `@orbit/automation-worker`
package is fully self-contained (only `@temporalio/*` + relative imports), so it builds standalone.
- **Dockerfile** `orbit-www/services/automation-worker/Dockerfile` (+ `.dockerignore`): `node:20-slim`,
  non-root uid 10001, `npm install` (the package's `tsx` is a runtime dep), runs `npm start` →
  `tsx src/worker.ts`. The Temporal worker bundles the workflow from `src/workflows` at startup.
- **docker-compose** service `orbit-automations-worker`: `depends_on temporal-server (healthy)`; env
  `TEMPORAL_ADDRESS=temporal-server:7233`, `TEMPORAL_NAMESPACE`, `ORBIT_API_URL=http://host.docker.internal:3000`,
  `ORBIT_INTERNAL_API_KEY`, `AUTOMATION_SCHEDULE_TZ=UTC`; `restart: unless-stopped`. Wired into
  `make dev` (`scripts/dev-start.sh` build+up lists) and `make dev-local` (Makefile), so the worker
  boots with the stack.
- **k8s** `infrastructure/k8s/automations-worker/` (deployment + kustomization, added to the root
  kustomization): 1-replica Deployment, `image: ghcr.io/drewpayment/orbit/automations-worker:latest`,
  non-root, `ORBIT_INTERNAL_API_KEY` from the `orbit-secrets` secret, `ORBIT_API_URL=http://orbit-www:3000`.
  Temporal dedupes fires; the worker is stateless/idempotent.
- **Verified:** image builds; `docker compose config` + `kubectl kustomize` validate; the containerized
  worker connects to `temporal-server:7233`, builds its workflow bundle in-image, polls `orbit-automations`,
  and on a triggered schedule its activity reaches the host app (`POST /api/internal/automations/dispatch 200`).

## Failure modes & idempotency
- **Temporal down at author time (schedule path)** → **fail-closed**: save fails atomically with
  a clear error; nothing persisted. No drift, no reconciler needed.
- **Temporal down at view time** → detail page degrades the "next run" line only.
- **Deterministic schedule id** (`automation:<id>`) makes create/update idempotent, delete exact.
- **Activity retry after a post-POST blip** → at worst a duplicate run (rare). Acceptable v1; a
  dispatch idempotency key (e.g. `scheduledActionId`) is a hardening follow-up.
- **Worker/queue isolation**: dedicated `orbit-automations` task queue; Go worker untouched.

## Local dev / how to run (Phase 1)
1. `make dev` (brings up Temporal + UI in OrbStack) + `cd orbit-www && bun run dev`.
2. `bun run worker:automations` (separate process) — against the real local Temporal.
3. Create a `schedule` automation (1-min cron) in the UI → a Schedule appears in Temporal UI
   (`:8080`) → on fire, a run appears on the automation detail page; "Next run" reads from Temporal.
4. Stop Temporal → try to create a schedule automation → the save fails with a clear error
   (fail-closed verified); creating an **event** automation still succeeds.

## Test plan
- **Unit (Vitest, pure):**
  - `scheduleOpFor(change)` decision table (§3) — pure, no Temporal.
  - Single-automation schedule dispatch (§4): mock-payload test that a schedule event +
    `automationId` dispatches exactly that automation, respects `enabled`, stamps `lastTriggeredAt`.
- **Lifecycle helper:** mock `@temporalio/client` to assert spec/action/paused mapping and that
  failures propagate (fail-closed), not swallowed.
- **agent-browser e2e (real Temporal):** schedule automation w/ near-future cron → worker running
  → run appears (Succeeded); detail "Next run" matches Temporal; Temporal-down → save error.

## Rollout / coexistence
Additive: new task queue + worker; Go worker and event automations unchanged. If the worker is
absent, schedule automations don't fire (and, with fail-closed authoring, can't be created while
Temporal is down) — no silent wrong state.

## Implementation status (Phase 1)
Built as designed, plus two hardening fixes that the live e2e surfaced. All file paths relative to `orbit-www/`.

**Shipped:**
- **Worker package** `services/automation-worker/` (`@orbit/automation-worker`): client-safe `./shared`
  contract, `./worker` runtime (thin `AutomationDispatchWorkflow` → `dispatchScheduledAutomation`
  activity POSTing the internal route), ESM `workflowsPath`. Wired as a bun workspace; Next's
  `transpilePackages: ['@orbit/automation-worker']` (next.config.mjs) consumes the raw-TS `./shared`.
- **Schedule lifecycle** `src/lib/temporal/automation-schedules.ts`: `ensureAutomationSchedule` /
  `deleteAutomationSchedule` / `getScheduleNextRun`, all fail-closed (errors propagate).
- **Fail-closed authoring** in `src/app/(frontend)/automations/actions.ts` per the §3 ordering table
  (pure `scheduleOpFor` + atomic create/update/delete with rollback). Detail page reads the
  authoritative next-run from Temporal (`[id]/page.tsx` degrades to "unavailable" at view time).
- **Single-automation schedule dispatch** in `src/lib/automations/dispatch.ts` (+ route `automationId`
  guard): a `schedule` event fires exactly its one automation; terminal guards return cleanly,
  transient errors propagate so Temporal retries.

**Hardening fixes (from live QA, 2026-06-28):**
- **Authoring requires required-input mappings.** The form previously let you save a schedule
  automation whose action had required inputs unmapped — it looked healthy but every dispatch failed
  `validateInputs` and no run was ever created (silent failure). Now `findUnmappedRequiredInputs`
  blocks the save server-side (create + update) and the form pre-checks + surfaces required inputs.
- **Terminal dispatch errors are non-retryable.** `createAndDispatchRun` throws a typed
  `InputValidationError`; the internal route maps it to **422 `{terminal:true}`**; the activity throws
  `ApplicationFailure.nonRetryable` on any 4xx — so a doomed dispatch fails once instead of
  retry-storming 5×/minute. (5xx/network stay retryable.)

**Verification:** 48 unit tests green (worker activity, schedule lifecycle, `scheduleOpFor`,
fail-closed create/update/delete + rollback, single-automation dispatch, authoring guard, 422/
non-retryable mapping). `output:'standalone'` build compiles and `@temporalio/worker` is provably
absent from the Next bundle (only `@temporalio/client` is bundled). Live agent-browser e2e against
real Temporal: schedule fires → run created; "Next run" from Temporal; fail-closed save when Temporal
down while event automations still save; authoring guard blocks the unmapped case; terminal dispatch
fails non-retryable with zero retries (Temporal workflow history confirmed).

## Open questions / follow-ups
1. Per-workspace timezone vs. global UTC (v1: UTC).
2. Dispatch idempotency key for exactly-once on activity retries.
3. *(Build reproducibility, minor)* the worker image runs `npm install` without a lockfile (the package
   lives in the orbit-www bun workspace). Pin with a committed lockfile or a multi-stage build if
   reproducible image builds become a requirement.
4. *(UX, minor)* warn at authoring time when a schedule automation maps a required input to an
   entity/rule template (`{{entity.*}}`/`{{rule.*}}`) that resolves empty for schedule events — today
   that passes the (presence) guard and fails non-retryably at dispatch (correct, but late feedback).
5. *(Optional, defensive only)* a reconciler for out-of-band Schedule drift (someone deleting a
   Schedule directly in Temporal). Not required by the fail-closed invariant; nice-to-have.
6. Eventually port select Go workflows to TS to collapse the language split (out of scope).
