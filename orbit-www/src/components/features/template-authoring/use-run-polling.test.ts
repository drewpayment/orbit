import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useRunPolling, isTerminalRunStatus, RUN_POLL_INTERVAL_MS } from './use-run-polling'
import type { ActionRun } from '@/payload-types'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function run(overrides?: Partial<ActionRun>): ActionRun {
  return {
    id: 'run-1',
    action: 'action-1',
    workspace: 'ws-1',
    status: 'pending',
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ActionRun
}

describe('useRunPolling', () => {
  it('fetches immediately on mount', async () => {
    const getRun = vi.fn().mockResolvedValue(run())
    const { result } = renderHook(() => useRunPolling('run-1', getRun))

    await waitFor(() => expect(result.current.run?.id).toBe('run-1'))
    expect(getRun).toHaveBeenCalledWith('run-1')
  })

  it('does nothing when runId is null', () => {
    const getRun = vi.fn()
    renderHook(() => useRunPolling(null, getRun))
    expect(getRun).not.toHaveBeenCalled()
  })

  it('polls every 2s by default while status is pending/awaiting-approval/running', async () => {
    vi.useFakeTimers()
    const getRun = vi
      .fn()
      .mockResolvedValueOnce(run({ status: 'pending' }))
      .mockResolvedValueOnce(run({ status: 'running' }))
      .mockResolvedValueOnce(run({ status: 'succeeded' }))

    renderHook(() => useRunPolling('run-1', getRun))

    await act(async () => {
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(3)
  })

  it('stops polling once status is terminal (succeeded)', async () => {
    vi.useFakeTimers()
    const getRun = vi.fn().mockResolvedValue(run({ status: 'succeeded' }))

    renderHook(() => useRunPolling('run-1', getRun))

    await act(async () => {
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
    })
    // No further polls scheduled after a terminal status.
    expect(getRun).toHaveBeenCalledTimes(1)
  })

  it('stops polling on failed and on cancelled', async () => {
    vi.useFakeTimers()
    for (const status of ['failed', 'cancelled'] as const) {
      const getRun = vi.fn().mockResolvedValue(run({ status }))
      const { unmount } = renderHook(() => useRunPolling('run-1', getRun))
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        vi.advanceTimersByTime(6000)
        await Promise.resolve()
      })
      expect(getRun).toHaveBeenCalledTimes(1)
      unmount()
    }
  })

  it('cleans up its interval on unmount', async () => {
    vi.useFakeTimers()
    const getRun = vi.fn().mockResolvedValue(run({ status: 'running' }))
    const { unmount } = renderHook(() => useRunPolling('run-1', getRun))

    await act(async () => {
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
    })
    // No calls after unmount.
    expect(getRun).toHaveBeenCalledTimes(1)
  })

  it('exposes an error and stops polling when getRun rejects', async () => {
    vi.useFakeTimers()
    const getRun = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useRunPolling('run-1', getRun))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('boom')

    await act(async () => {
      vi.advanceTimersByTime(6000)
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(1)
  })

  it('respects a custom intervalMs', async () => {
    vi.useFakeTimers()
    const getRun = vi.fn().mockResolvedValue(run({ status: 'running' }))
    renderHook(() => useRunPolling('run-1', getRun, { intervalMs: 500 }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledTimes(2)
  })

  it('restarts polling when runId changes', async () => {
    vi.useFakeTimers()
    const getRun = vi.fn().mockResolvedValue(run({ status: 'running' }))
    const { rerender } = renderHook(({ id }: { id: string | null }) => useRunPolling(id, getRun), {
      initialProps: { id: 'run-1' as string | null },
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledWith('run-1')

    rerender({ id: 'run-2' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(getRun).toHaveBeenCalledWith('run-2')
  })

  it('exposes RUN_POLL_INTERVAL_MS as 2000', () => {
    expect(RUN_POLL_INTERVAL_MS).toBe(2000)
  })

  describe('isTerminalRunStatus', () => {
    it('is true for succeeded, failed, and cancelled', () => {
      expect(isTerminalRunStatus('succeeded')).toBe(true)
      expect(isTerminalRunStatus('failed')).toBe(true)
      expect(isTerminalRunStatus('cancelled')).toBe(true)
    })

    it('is false for pending, running, and awaiting-approval', () => {
      expect(isTerminalRunStatus('pending')).toBe(false)
      expect(isTerminalRunStatus('running')).toBe(false)
      expect(isTerminalRunStatus('awaiting-approval')).toBe(false)
    })

    it('is false for null/undefined/unknown values', () => {
      expect(isTerminalRunStatus(null)).toBe(false)
      expect(isTerminalRunStatus(undefined)).toBe(false)
      expect(isTerminalRunStatus('something-else')).toBe(false)
    })
  })

  describe('isPolling', () => {
    it('is false when runId is null', () => {
      const getRun = vi.fn()
      const { result } = renderHook(() => useRunPolling(null, getRun))
      expect(result.current.isPolling).toBe(false)
    })

    it('is true while the run is non-terminal, false once terminal', async () => {
      vi.useFakeTimers()
      const getRun = vi
        .fn()
        .mockResolvedValueOnce(run({ status: 'pending' }))
        .mockResolvedValueOnce(run({ status: 'succeeded' }))
      const { result } = renderHook(() => useRunPolling('run-1', getRun))

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.isPolling).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })
      expect(result.current.isPolling).toBe(false)
    })

    it('is false after a getRun rejection', async () => {
      vi.useFakeTimers()
      const getRun = vi.fn().mockRejectedValue(new Error('boom'))
      const { result } = renderHook(() => useRunPolling('run-1', getRun))

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(result.current.isPolling).toBe(false)
    })
  })

  describe('refresh', () => {
    it('immediately re-fetches without waiting for the interval', async () => {
      vi.useFakeTimers()
      const getRun = vi.fn().mockResolvedValue(run({ status: 'running' }))
      const { result } = renderHook(() => useRunPolling('run-1', getRun))

      await act(async () => {
        await Promise.resolve()
      })
      expect(getRun).toHaveBeenCalledTimes(1)

      await act(async () => {
        await result.current.refresh()
      })
      expect(getRun).toHaveBeenCalledTimes(2)
    })

    it('updates run/error from the manual fetch and reschedules based on the new status', async () => {
      vi.useFakeTimers()
      const getRun = vi
        .fn()
        .mockResolvedValueOnce(run({ status: 'running' }))
        .mockResolvedValueOnce(run({ status: 'succeeded' }))
      const { result } = renderHook(() => useRunPolling('run-1', getRun))

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.run?.status).toBe('running')

      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.run?.status).toBe('succeeded')
      expect(result.current.isPolling).toBe(false)

      // No further automatic poll after refresh lands on a terminal status.
      await act(async () => {
        vi.advanceTimersByTime(10_000)
        await Promise.resolve()
      })
      expect(getRun).toHaveBeenCalledTimes(2)
    })

    it('is a no-op when runId is null', async () => {
      const getRun = vi.fn()
      const { result } = renderHook(() => useRunPolling(null, getRun))
      await act(async () => {
        await result.current.refresh()
      })
      expect(getRun).not.toHaveBeenCalled()
    })
  })
})
