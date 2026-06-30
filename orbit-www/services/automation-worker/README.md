# @orbit/automation-worker

Temporal worker that fires **`schedule`-type Orbit automations** (P4.2).

Each schedule automation owns a Temporal Schedule (created by the Next.js app via
`@temporalio/client`). When a schedule is due, Temporal starts the thin
`AutomationDispatchWorkflow` on the dedicated `orbit-automations` task queue. The
workflow's single activity, `dispatchScheduledAutomation`, POSTs to orbit-www's
existing internal route:

```
POST ${ORBIT_API_URL}/api/internal/automations/dispatch
  headers: X-API-Key: ${ORBIT_INTERNAL_API_KEY}
  body:    { "type": "schedule", "workspace": "<workspaceId>", "automationId": "<id>" }
```

All real work (loading the automation, resolving inputs, creating + executing the
run) stays in orbit-www. This worker is intentionally thin and imports no
Payload/Mongo/`server-only` code.

See `docs/plans/2026-06-27-automation-temporal-ts-worker.md` for the full design.

## Environment variables

| Var | Default | Read in | Purpose |
|---|---|---|---|
| `TEMPORAL_ADDRESS` | `localhost:7233` | worker | Temporal frontend `host:port`. |
| `TEMPORAL_NAMESPACE` | `default` | worker | Temporal namespace to poll. |
| `ORBIT_API_URL` | — (**required**) | activity | Base URL of the Next.js app, e.g. `http://localhost:3000`. |
| `ORBIT_INTERNAL_API_KEY` | — (**required**) | activity | Key for the internal dispatch route (`X-API-Key`). |
| `AUTOMATION_SCHEDULE_TZ` | `UTC` | Next.js (schedule lifecycle) | Schedule timezone. Not read by this worker; listed for completeness. |

The activity throws a clear error if `ORBIT_API_URL` or `ORBIT_INTERNAL_API_KEY`
is missing, and throws on any non-2xx dispatch response so Temporal retries
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

A clean startup logs the task queue, namespace, and Temporal address. The worker
drains in-flight work on `SIGINT`/`SIGTERM` and exits non-zero on a fatal error.

## Typecheck

```bash
cd orbit-www && bunx tsc --noEmit -p services/automation-worker/tsconfig.json
```
