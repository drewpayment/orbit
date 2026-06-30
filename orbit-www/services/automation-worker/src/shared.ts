/**
 * Client-safe contract for the automation Temporal worker (P4.2).
 *
 * Imported by BOTH the Next.js app (schedule lifecycle helpers + server actions)
 * and the worker runtime (workflow + activity + worker entry). It is the single
 * source of truth for the workflow name, task queue, schedule id, and the input
 * shape passed from a Temporal Schedule action to the dispatch workflow.
 *
 * INVARIANT — this module MUST stay free of:
 *   - any `@temporalio/worker | @temporalio/workflow | @temporalio/activity` import,
 *   - any Node-only API (`fs`, `process` reads at module scope, etc.),
 *   - any `server-only` dependency.
 * That isolation is what lets a Next server action `import ... from
 * '@orbit/automation-worker/shared'` WITHOUT dragging the worker runtime into the
 * Next bundle. See docs/plans/2026-06-27-automation-temporal-ts-worker.md (task 0).
 */

/** Registered name of the dispatch workflow — must match the worker's registration. */
export const AUTOMATION_DISPATCH_WORKFLOW = 'AutomationDispatchWorkflow' as const

/**
 * Dedicated task queue for automation schedules. Isolated from the Go worker's
 * `orbit-workflows` queue so the two never poll each other's tasks.
 */
export const AUTOMATION_TASK_QUEUE = 'orbit-automations' as const

/**
 * Default schedule timezone for v1. Per-workspace timezone is a follow-up; the
 * detail page reads the authoritative next-run from Temporal so the displayed
 * time is always correct regardless of this value. Callers may override via the
 * `AUTOMATION_SCHEDULE_TZ` env var (read at the call site, NOT here — keep this
 * module free of `process` access so the workflow sandbox can import it).
 */
export const DEFAULT_AUTOMATION_SCHEDULE_TZ = 'UTC' as const

/** Input passed from the Temporal Schedule action → dispatch workflow → activity. */
export interface AutomationDispatchInput {
  automationId: string
  workspaceId: string
}

/**
 * Deterministic Temporal Schedule id for an automation. The determinism is what
 * makes create/update idempotent and delete exact: `schedule automation exists
 * ⇔ a Temporal Schedule with this id exists`.
 */
export function scheduleId(automationId: string): string {
  return `automation:${automationId}`
}
