/**
 * Temporal Schedule lifecycle for the GLOBAL scorecard evaluation sweep
 * (scorecards roadmap item 1).
 *
 * Unlike automations (one Schedule per record, managed by the Next.js app), the
 * sweep is a single global nightly Schedule that the WORKER self-manages at
 * startup — there is no app-side bootstrap. The pattern mirrors
 * `ensureAutomationSchedule` in `orbit-www/src/lib/temporal/automation-schedules.ts`:
 * create, catch `ScheduleAlreadyRunning`, converge via `getHandle().update()`.
 *
 * FAIL-CLOSED: this PROPAGATES every non-already-exists error. The worker treats
 * an ensure failure at startup as fatal (exits nonzero, the deployment restarts
 * it) so we never poll a task queue whose sweep Schedule we could not guarantee.
 *
 * The schedule client uses `Connection` (distinct from the worker's
 * `NativeConnection`), so this module imports `@temporalio/client` and therefore
 * must NOT be imported by the workflow sandbox — only `worker.ts` imports it.
 *
 * See docs/plans/2026-07-02-scheduled-scorecard-evaluation.md.
 */

import { Client, Connection, ScheduleAlreadyRunning } from '@temporalio/client'

import {
  AUTOMATION_TASK_QUEUE,
  DEFAULT_AUTOMATION_SCHEDULE_TZ,
  DEFAULT_SCORECARD_EVAL_CRON,
  SCORECARD_SWEEP_SCHEDULE_ID,
  SCORECARD_SWEEP_WORKFLOW,
} from './shared'

/** Sweep cadence — a single global cron, overridable via env. */
function sweepCron(): string {
  return process.env.SCORECARD_EVAL_CRON || DEFAULT_SCORECARD_EVAL_CRON
}

/** Cron timezone — reuses the automations convention/env. */
function sweepTimezone(): string {
  return process.env.AUTOMATION_SCHEDULE_TZ || DEFAULT_AUTOMATION_SCHEDULE_TZ
}

/** The sweep is paused when explicitly disabled via env (`1`/`true`). */
export function isSweepDisabled(): boolean {
  const v = process.env.SCORECARD_EVAL_DISABLED
  return v === '1' || v === 'true'
}

/**
 * Create-or-converge the single global sweep Schedule on the given client.
 * Idempotent on `SCORECARD_SWEEP_SCHEDULE_ID`: a create that races an existing
 * Schedule falls back to an update converging spec/action/paused. The Schedule is
 * paused when `SCORECARD_EVAL_DISABLED` is set. Throws on any real Temporal
 * failure (fail-closed).
 *
 * Accepts the client as a param so it is unit-testable with a fake client; use
 * {@link connectAndEnsureSchedule} for the connect-then-ensure convenience the
 * worker entry point wants.
 */
export async function ensureScorecardSweepSchedule(client: Client): Promise<void> {
  const paused = isSweepDisabled()

  const spec = {
    cronExpressions: [sweepCron()],
    // NOTE: @temporalio/client@^1.13.0 spells this `timezone` (lower-case z),
    // not `timeZone` — matching ensureAutomationSchedule.
    timezone: sweepTimezone(),
  }
  const action = {
    type: 'startWorkflow' as const,
    workflowType: SCORECARD_SWEEP_WORKFLOW,
    taskQueue: AUTOMATION_TASK_QUEUE,
    // The sweep discovers its own work via the `/due` activity — no args.
    args: [] as const,
  }

  try {
    // No explicit overlap policy: Temporal's default is Skip, so if a sweep is
    // still running when the next cron tick fires, that tick is skipped rather
    // than started concurrently — exactly what we want (no pile-up of overlapping
    // full-catalog sweeps).
    await client.schedule.create({
      scheduleId: SCORECARD_SWEEP_SCHEDULE_ID,
      spec,
      action,
      state: { paused },
    })
  } catch (err) {
    // A Schedule with this id already exists — converge it to the current spec.
    if (err instanceof ScheduleAlreadyRunning) {
      const handle = client.schedule.getHandle(SCORECARD_SWEEP_SCHEDULE_ID)
      await handle.update((prev) => ({
        ...prev,
        spec,
        action,
        state: { ...prev.state, paused },
      }))
      return
    }
    throw err
  }
}

/**
 * Connect a schedule {@link Client} (via `Connection`, distinct from the worker's
 * `NativeConnection`) and ensure the sweep Schedule. Returns the connection so
 * the caller can close it after the ensure. Convenience for the worker entry
 * point; the ensure itself is tested via {@link ensureScorecardSweepSchedule}.
 */
export async function connectAndEnsureSchedule(
  address: string,
  namespace: string,
): Promise<Connection> {
  const connection = await Connection.connect({ address })
  try {
    const client = new Client({ connection, namespace })
    await ensureScorecardSweepSchedule(client)
    return connection
  } catch (err) {
    await connection.close().catch(() => undefined)
    throw err
  }
}
