import 'server-only'
import { ScheduleAlreadyRunning, ScheduleNotFoundError } from '@temporalio/client'
import {
  AUTOMATION_TASK_QUEUE,
  AUTOMATION_DISPATCH_WORKFLOW,
  DEFAULT_AUTOMATION_SCHEDULE_TZ,
  scheduleId,
  type AutomationDispatchInput,
} from '@orbit/automation-worker/shared'
import { getTemporalClient } from '@/lib/temporal/client'

/**
 * Temporal Schedule lifecycle for `schedule`-type automations (P4.2).
 *
 * FAIL-CLOSED: for schedule automations Temporal is a hard dependency. Every
 * helper here PROPAGATES errors rather than swallowing them — there is no
 * best-effort wrapper. Callers (the automation server actions) translate a
 * Temporal failure into a user-facing "scheduling service unavailable" error so
 * the record is never written without its Schedule (and vice-versa). The
 * invariant is: a schedule automation exists ⇔ its Temporal Schedule exists.
 *
 * The `getScheduleNextRun` read is the one soft-failure path — the detail page
 * wraps it and degrades the "next run" line if Temporal is unreachable at view
 * time (distinct from the write-time hard failure).
 *
 * @see docs/plans/2026-06-27-automation-temporal-ts-worker.md (sections 2, 3, 5)
 */

/** The cron timezone for v1 — a single global value, overridable via env. */
function scheduleTimezone(): string {
  return process.env.AUTOMATION_SCHEDULE_TZ || DEFAULT_AUTOMATION_SCHEDULE_TZ
}

/**
 * Create-or-update the Temporal Schedule for a schedule automation. Idempotent
 * on the deterministic `scheduleId` so a create that races an existing Schedule
 * falls back to an update. The Schedule starts paused when the automation is
 * disabled. Throws on any real Temporal failure (fail-closed).
 */
export async function ensureAutomationSchedule(input: {
  id: string
  workspaceId: string
  cron: string
  enabled: boolean
}): Promise<void> {
  const client = await getTemporalClient()
  const sid = scheduleId(input.id)

  const spec = {
    cronExpressions: [input.cron],
    // NOTE: the installed @temporalio/client@^1.13.0 spells this `timezone`
    // (lower-case z), not `timeZone`. See the report for this deviation.
    timezone: scheduleTimezone(),
  }
  const action = {
    type: 'startWorkflow' as const,
    workflowType: AUTOMATION_DISPATCH_WORKFLOW,
    taskQueue: AUTOMATION_TASK_QUEUE,
    args: [
      { automationId: input.id, workspaceId: input.workspaceId } satisfies AutomationDispatchInput,
    ],
  }

  try {
    await client.schedule.create({
      scheduleId: sid,
      spec,
      action,
      state: { paused: !input.enabled },
    })
  } catch (err) {
    // A Schedule with this id already exists — converge it to the new spec.
    if (err instanceof ScheduleAlreadyRunning) {
      const handle = client.schedule.getHandle(sid)
      await handle.update((prev) => ({
        ...prev,
        spec,
        action,
        state: { ...prev.state, paused: !input.enabled },
      }))
      return
    }
    throw err
  }
}

/**
 * Delete the Temporal Schedule for an automation. Treats NOT-FOUND as success
 * (the both-or-neither invariant is already satisfied) but propagates any other
 * failure so a delete is never silently dropped.
 */
export async function deleteAutomationSchedule(automationId: string): Promise<void> {
  const client = await getTemporalClient()
  try {
    await client.schedule.getHandle(scheduleId(automationId)).delete()
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return
    throw err
  }
}

/**
 * The authoritative next-run time for a schedule automation, as an ISO string,
 * or null when Temporal reports no upcoming action. May throw if Temporal is
 * unreachable — the caller wraps this for read-time graceful degradation.
 */
export async function getScheduleNextRun(automationId: string): Promise<string | null> {
  const client = await getTemporalClient()
  const description = await client.schedule.getHandle(scheduleId(automationId)).describe()
  return description.info.nextActionTimes?.[0]?.toISOString() ?? null
}
