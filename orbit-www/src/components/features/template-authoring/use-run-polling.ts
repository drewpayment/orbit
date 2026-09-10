'use client'

/**
 * `useRunPolling` — client hook for live-ish run status (Phase 2 plan Task
 * 15 / design §3.6). There is no streaming transport for `action-runs`
 * (see plan §1 "Runs today poll, they don't stream" + §6 risk #1), so this
 * polls a `getRun`-style server action every `intervalMs` (default
 * {@link RUN_POLL_INTERVAL_MS}) while the run is in a non-terminal state
 * (`pending`, `awaiting-approval`, `running`), and stops once it reaches a
 * terminal state (`succeeded`/`failed`/`cancelled`, see
 * {@link isTerminalRunStatus}).
 *
 * Used by both the authoring dry-run panel (Task 14) and the consumer run
 * detail page (Task 17) — kept at this exact path/name/signature so either
 * of two independently-authored worktrees' copies is interchangeable; see
 * the coordination note in the Task 15/17 delegation. PR #105 review:
 * additively extended with `isPolling`/`refresh` plus the exported
 * `isTerminalRunStatus`/`RUN_POLL_INTERVAL_MS` helpers so a second copy
 * (the authoring-shell branch's) can be dropped in favor of this one
 * without call-site changes beyond adopting the new optional fields.
 */
import * as React from 'react'
import type { ActionRun } from '@/payload-types'

/** Default poll interval in ms — also the plan's documented "every ~2s" cadence. */
export const RUN_POLL_INTERVAL_MS = 2000

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'cancelled'])

/** Whether an `ActionRun.status` value (or any string) is a terminal run status. Null/undefined/unknown values are treated as non-terminal. */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(status)
}

export interface UseRunPollingOptions {
  /** Poll interval in ms while the run is non-terminal. Defaults to {@link RUN_POLL_INTERVAL_MS}. */
  intervalMs?: number
}

export interface UseRunPollingResult {
  run: ActionRun | null
  error: Error | null
  /** True while the hook is actively polling (has a pending or scheduled fetch) — false once terminal, once errored, or when `runId` is null. */
  isPolling: boolean
  /** Immediately re-fetches, bypassing the interval wait, and reschedules (or stops) based on the fresh result. A no-op when `runId` is null. */
  refresh: () => Promise<void>
}

/**
 * Polls `getRun(runId)` while the run's `status` is non-terminal, stopping
 * on a terminal status or when the hook unmounts. Passing `runId: null`
 * disables polling entirely (e.g. before a run has been created).
 */
export function useRunPolling(
  runId: string | null,
  getRun: (id: string) => Promise<ActionRun | null>,
  opts?: UseRunPollingOptions,
): UseRunPollingResult {
  const intervalMs = opts?.intervalMs ?? RUN_POLL_INTERVAL_MS
  const [run, setRun] = React.useState<ActionRun | null>(null)
  const [error, setError] = React.useState<Error | null>(null)
  const [isPolling, setIsPolling] = React.useState(false)

  // Keep the latest getRun without re-triggering the polling effect if the
  // caller passes a fresh function identity on every render.
  const getRunRef = React.useRef(getRun)
  getRunRef.current = getRun

  // `doPollRef` lets `refresh()` invoke the SAME fetch-and-reschedule logic
  // the effect's timer uses, without recreating the effect. It's reassigned
  // on every effect run (new runId/intervalMs), and is a no-op when polling
  // is disabled (`runId` is null).
  const doPollRef = React.useRef<() => Promise<void>>(async () => {})
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    setRun(null)
    setError(null)
    setIsPolling(false)

    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!runId) {
      doPollRef.current = async () => {}
      return
    }

    let cancelled = false

    async function doPoll() {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      try {
        const next = await getRunRef.current(runId as string)
        if (cancelled) return
        setError(null)
        setRun(next)
        if (next && !isTerminalRunStatus(next.status)) {
          setIsPolling(true)
          timerRef.current = setTimeout(doPoll, intervalMs)
        } else {
          setIsPolling(false)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setIsPolling(false)
        // Stop polling on error — a persistent failure (e.g. permission
        // denial, network error) would otherwise retry forever.
      }
    }

    doPollRef.current = doPoll
    void doPoll()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [runId, intervalMs])

  const refresh = React.useCallback(async () => {
    await doPollRef.current()
  }, [])

  return { run, error, isPolling, refresh }
}
