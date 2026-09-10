'use client'

/**
 * `useRunPolling` — client hook for live-ish run status (Phase 2 plan Task
 * 15 / design §3.6). There is no streaming transport for `action-runs`
 * (see plan §1 "Runs today poll, they don't stream" + §6 risk #1), so this
 * polls a `getRun`-style server action every `intervalMs` (default 2s)
 * while the run is in a non-terminal state (`pending`, `awaiting-approval`,
 * `running`), and stops once it reaches a terminal state
 * (`succeeded`/`failed`/`cancelled`).
 *
 * Used by both the authoring dry-run panel (Task 14) and the consumer run
 * detail page (Task 17) — kept at this exact path/name/signature so either
 * of two independently-authored worktrees' copies is interchangeable; see
 * the coordination note in the Task 15/17 delegation.
 */
import * as React from 'react'
import type { ActionRun } from '@/payload-types'

const DEFAULT_INTERVAL_MS = 2000

const TERMINAL_STATUSES: ReadonlySet<ActionRun['status']> = new Set([
  'succeeded',
  'failed',
  'cancelled',
])

export interface UseRunPollingOptions {
  /** Poll interval in ms while the run is non-terminal. Defaults to 2000. */
  intervalMs?: number
}

export interface UseRunPollingResult {
  run: ActionRun | null
  error: Error | null
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
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS
  const [run, setRun] = React.useState<ActionRun | null>(null)
  const [error, setError] = React.useState<Error | null>(null)

  // Keep the latest getRun without re-triggering the polling effect if the
  // caller passes a fresh function identity on every render.
  const getRunRef = React.useRef(getRun)
  getRunRef.current = getRun

  React.useEffect(() => {
    setRun(null)
    setError(null)

    if (!runId) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const next = await getRunRef.current(runId as string)
        if (cancelled) return
        setError(null)
        setRun(next)
        if (next && !TERMINAL_STATUSES.has(next.status)) {
          timer = setTimeout(poll, intervalMs)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
        // Stop polling on error — a persistent failure (e.g. permission
        // denial, network error) would otherwise retry forever.
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [runId, intervalMs])

  return { run, error }
}
