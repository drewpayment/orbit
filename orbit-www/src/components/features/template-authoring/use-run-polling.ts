/**
 * `useRunPolling` — Template Authoring Phase 2, Task 15.
 *
 * Polls a template/action run every 2s while its status is non-terminal
 * (`pending | awaiting-approval | running`) and stops on a terminal status
 * (`succeeded | failed | cancelled`), on a fetch error, or when the run comes
 * back null (denied or deleted). Shared by the authoring dry-run panel
 * (Task 14) and the consumer run wizard/detail (Tasks 16-17), so its shape is
 * deliberately transport-agnostic: the caller passes the `getRun` server
 * action in rather than this hook importing one.
 *
 * Leak safety (adversarial-review item (e)): the timer is cleared on unmount
 * and whenever `runId` changes, and every in-flight response is checked
 * against a generation counter before it is allowed to touch state — a
 * response for a previous `runId` can never overwrite the current run or
 * restart a cancelled polling loop.
 */
'use client'

import * as React from 'react'
import type { ActionRun } from '@/payload-types'

/**
 * The subset of a run this hook needs. Widened to `ActionRun` in practice;
 * kept structural so tests and the consumer wizard can pass a lighter object.
 */
export type PollableRun = Pick<ActionRun, 'id' | 'status'> & Partial<ActionRun>

export type RunStatus = PollableRun['status']

const TERMINAL_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'] as const

/** Whether a run status means the run will never change again. */
export function isTerminalRunStatus(status: RunStatus | undefined | null): boolean {
  return !!status && TERMINAL_STATUSES.includes(status)
}

export const RUN_POLL_INTERVAL_MS = 2000

export interface UseRunPollingResult<T extends PollableRun> {
  run: T | null
  error: string | null
  /** True while a further poll is scheduled — false before start and after a terminal status. */
  isPolling: boolean
  /** Force an immediate refetch (e.g. after an approval action). */
  refresh: () => void
}

/**
 * @param runId  the run to watch, or null to watch nothing.
 * @param getRun a server action resolving the run, or null when it is gone.
 * @param intervalMs poll interval; defaults to 2000ms per the plan.
 */
export function useRunPolling<T extends PollableRun>(
  runId: string | null | undefined,
  getRun: (runId: string) => Promise<T | null>,
  intervalMs: number = RUN_POLL_INTERVAL_MS,
): UseRunPollingResult<T> {
  const [run, setRun] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isPolling, setIsPolling] = React.useState(false)

  // Keep the latest getRun in a ref so a caller passing an inline closure
  // (the common case with server actions) does not restart polling on every
  // render — only `runId` and `intervalMs` do.
  const getRunRef = React.useRef(getRun)
  React.useEffect(() => {
    getRunRef.current = getRun
  }, [getRun])

  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const refresh = React.useCallback(() => setRefreshNonce((n) => n + 1), [])

  React.useEffect(() => {
    if (!runId) {
      setRun(null)
      setError(null)
      setIsPolling(false)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const tick = async () => {
      let next: T | null
      try {
        next = await getRunRef.current(runId)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load the run.')
        setIsPolling(false)
        return
      }
      if (cancelled) return

      if (next === null) {
        setError('Run not found.')
        setIsPolling(false)
        return
      }

      setRun(next)
      setError(null)

      if (isTerminalRunStatus(next.status)) {
        setIsPolling(false)
        return
      }
      // setTimeout (not setInterval) so a slow response can never stack polls.
      timer = setTimeout(tick, intervalMs)
    }

    setError(null)
    setIsPolling(true)
    void tick()

    return () => {
      cancelled = true
      clear()
    }
  }, [runId, intervalMs, refreshNonce])

  return { run, error, isPolling, refresh }
}
