import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useRunPolling, type PollableRun } from './use-run-polling'

function run(status: PollableRun['status']): PollableRun {
  return { id: 'run-1', status } as PollableRun
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useRunPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /** Flush the microtask queue so awaited getRun promises settle under fake timers. */
  async function flush() {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('does nothing while runId is null', async () => {
    const getRun = vi.fn()
    const { result } = renderHook(() => useRunPolling(null, getRun))
    await advance(10_000)
    expect(getRun).not.toHaveBeenCalled()
    expect(result.current.run).toBeNull()
    expect(result.current.isPolling).toBe(false)
  })

  it('fetches immediately when given a runId', async () => {
    const getRun = vi.fn().mockResolvedValue(run('running'))
    const { result } = renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    expect(getRun).toHaveBeenCalledTimes(1)
    expect(getRun).toHaveBeenCalledWith('run-1')
    expect(result.current.run?.status).toBe('running')
  })

  it('keeps polling every 2s while the status is non-terminal', async () => {
    const getRun = vi.fn().mockResolvedValue(run('pending'))
    renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    expect(getRun).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(getRun).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(getRun).toHaveBeenCalledTimes(3)
  })

  it('polls through awaiting-approval', async () => {
    const getRun = vi.fn().mockResolvedValue(run('awaiting-approval'))
    renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    await advance(2000)
    expect(getRun).toHaveBeenCalledTimes(2)
  })

  it('stops polling once the run succeeds', async () => {
    const getRun = vi
      .fn()
      .mockResolvedValueOnce(run('running'))
      .mockResolvedValue(run('succeeded'))
    const { result } = renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    await advance(2000)
    expect(getRun).toHaveBeenCalledTimes(2)
    await advance(10_000)
    expect(getRun).toHaveBeenCalledTimes(2)
    expect(result.current.run?.status).toBe('succeeded')
    expect(result.current.isPolling).toBe(false)
  })

  it.each(['failed', 'cancelled'] as const)('stops polling on %s', async (terminal) => {
    const getRun = vi.fn().mockResolvedValue(run(terminal))
    renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    await advance(10_000)
    expect(getRun).toHaveBeenCalledTimes(1)
  })

  it('clears its timer on unmount so no fetch happens afterwards', async () => {
    const getRun = vi.fn().mockResolvedValue(run('running'))
    const { unmount } = renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    expect(getRun).toHaveBeenCalledTimes(1)
    unmount()
    await advance(20_000)
    expect(getRun).toHaveBeenCalledTimes(1)
  })

  it('surfaces a fetch error and stops polling', async () => {
    const getRun = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    expect(result.current.error).toBe('boom')
    await advance(10_000)
    expect(getRun).toHaveBeenCalledTimes(1)
    expect(result.current.isPolling).toBe(false)
  })

  it('treats a null run (denied or deleted) as terminal', async () => {
    const getRun = vi.fn().mockResolvedValue(null)
    const { result } = renderHook(() => useRunPolling('run-1', getRun))
    await flush()
    await advance(10_000)
    expect(getRun).toHaveBeenCalledTimes(1)
    expect(result.current.error).toMatch(/not found/i)
  })

  it('restarts polling when the runId changes', async () => {
    const getRun = vi.fn().mockResolvedValue(run('succeeded'))
    const { rerender } = renderHook(({ id }: { id: string | null }) => useRunPolling(id, getRun), {
      initialProps: { id: 'run-1' as string | null },
    })
    await flush()
    expect(getRun).toHaveBeenCalledTimes(1)
    rerender({ id: 'run-2' })
    await flush()
    expect(getRun).toHaveBeenCalledTimes(2)
    expect(getRun).toHaveBeenLastCalledWith('run-2')
  })

  it('drops a response that arrives after the runId changed', async () => {
    let resolveFirst: (v: PollableRun) => void = () => {}
    const getRun = vi
      .fn()
      .mockImplementationOnce(() => new Promise<PollableRun>((r) => (resolveFirst = r)))
      .mockResolvedValue({ ...run('succeeded'), id: 'run-2' })
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useRunPolling(id, getRun),
      { initialProps: { id: 'run-1' as string | null } },
    )
    await flush()
    rerender({ id: 'run-2' })
    await flush()
    act(() => resolveFirst({ ...run('failed'), id: 'run-1' }))
    await flush()
    expect(result.current.run?.id).toBe('run-2')
  })
})
