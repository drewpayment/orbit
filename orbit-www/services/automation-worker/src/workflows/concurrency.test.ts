import { describe, it, expect } from 'vitest'
import { groupByKey, runWithConcurrency } from './concurrency'

/**
 * Unit tests for the sandbox-safe bounded-concurrency helper used by the
 * scorecard sweep. The helper is pure JS (no Temporal/Node imports) so it is
 * safe to import from a workflow module; these tests exercise it directly.
 *
 * The three invariants: results come back in INPUT order regardless of
 * completion order; no more than `limit` tasks run concurrently; and an error
 * from any task rejects the whole call.
 */

/** A controllable async task: resolves when `release()` is called. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('runWithConcurrency', () => {
  it('returns results in input order even when tasks finish out of order', async () => {
    const items = [10, 20, 30, 40]
    // Finish in reverse order but expect input-order results.
    const result = await runWithConcurrency(items, 2, async (n) => {
      await new Promise((r) => setTimeout(r, (50 - n) / 5))
      return n * 2
    })
    expect(result).toEqual([20, 40, 60, 80])
  })

  it('never runs more than `limit` tasks concurrently', async () => {
    const items = [0, 1, 2, 3, 4, 5]
    let inFlight = 0
    let maxInFlight = 0
    const gates = items.map(() => deferred<void>())

    const promise = runWithConcurrency(items, 3, async (i) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await gates[i].promise
      inFlight--
      return i
    })

    // Let the scheduler start the first wave.
    await new Promise((r) => setTimeout(r, 0))
    expect(maxInFlight).toBe(3)

    // Release everything and let it drain.
    gates.forEach((g) => g.resolve())
    const result = await promise
    expect(result).toEqual(items)
    expect(maxInFlight).toBe(3)
  })

  it('propagates a task error to the caller', async () => {
    const items = [1, 2, 3]
    await expect(
      runWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })

  it('handles an empty input list', async () => {
    const result = await runWithConcurrency([], 3, async (n) => n)
    expect(result).toEqual([])
  })

  it('handles a limit larger than the number of items', async () => {
    const result = await runWithConcurrency([1, 2], 10, async (n) => n * 10)
    expect(result).toEqual([10, 20])
  })
})

describe('groupByKey', () => {
  it('keeps scorecards from one workspace together and preserves input order', () => {
    const groups = groupByKey(
      [
        { id: 'a', workspaceId: 'ws1' },
        { id: 'b', workspaceId: 'ws2' },
        { id: 'c', workspaceId: 'ws1' },
      ],
      (item) => item.workspaceId,
    )

    expect(groups).toEqual([
      {
        key: 'ws1',
        items: [
          { id: 'a', workspaceId: 'ws1' },
          { id: 'c', workspaceId: 'ws1' },
        ],
      },
      { key: 'ws2', items: [{ id: 'b', workspaceId: 'ws2' }] },
    ])
  })
})

/**
 * Tests for `errorDetail` — the helper that pulls the useful message out of a
 * rejected activity. After retry exhaustion `proxyActivities` rejects with an
 * ActivityFailure whose `.message` is framework-generic ("Activity task failed")
 * and whose real "…returned 500: <body>" detail is in `.cause`, so we prefer the
 * cause's message when present.
 */
import { errorDetail } from './concurrency'

describe('errorDetail', () => {
  it('returns the message of a plain Error', () => {
    expect(errorDetail(new Error('boom'))).toBe('boom')
  })

  it('prefers the cause message when an Error has an Error cause', () => {
    const cause = new Error('evaluateScorecard: evaluate route returned 500: kaboom')
    const err = new Error('Activity task failed', { cause })
    expect(errorDetail(err)).toBe('evaluateScorecard: evaluate route returned 500: kaboom')
  })

  it('falls back to the outer message when the cause is not an Error', () => {
    const err = new Error('outer', { cause: 'a string cause' })
    expect(errorDetail(err)).toBe('outer')
  })

  it('stringifies a non-Error value', () => {
    expect(errorDetail('just a string')).toBe('just a string')
    expect(errorDetail(42)).toBe('42')
  })
})
