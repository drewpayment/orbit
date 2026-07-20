/**
 * Bounded-concurrency runner + error-detail extraction — pure JS, sandbox-safe.
 *
 * INVARIANT: this module imports NOTHING (no Temporal, no Node), so it is safe to
 * import from a Temporal workflow module that runs in the deterministic V8
 * sandbox. It uses only `Promise` and array primitives — no timers, no
 * `Date.now()`, no `Math.random()`.
 */

/**
 * Run `fn` over `items` with at most `limit` invocations in flight at once, and
 * return the results in INPUT order (index-stable) regardless of the order in
 * which the individual tasks settle. Any task rejection rejects the whole call
 * (first error wins); callers that need per-item error isolation should have `fn`
 * catch internally and return a result sentinel — which is exactly what the
 * scorecard sweep does so one bad scorecard never aborts the sweep.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  // Shared cursor: each worker atomically (single-threaded event loop) claims
  // the next index, so exactly `min(limit, items.length)` workers race through
  // the list without ever exceeding the limit.
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }

  const workerCount = Math.max(0, Math.min(limit, items.length))
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)

  return results
}

/** Group input-order-stably without relying on Node APIs (workflow sandbox safe). */
export function groupByKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = []
  const indexByKey = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length)
      groups.push({ key, items: [item] })
    } else {
      groups[existingIndex].items.push(item)
    }
  }
  return groups
}

/**
 * Extract the human-useful detail from a rejected value.
 *
 * A `proxyActivities` call that exhausts its retries rejects with an
 * ActivityFailure whose own `.message` is framework-generic ("Activity task
 * failed") — the real "…returned 500: <body>" detail lives in `.cause`. So when
 * `err` is an Error whose `cause` is also an Error, prefer the cause's message;
 * otherwise fall back to the Error's own message, and finally to `String(err)`
 * for non-Error rejections. Kept sandbox-safe (no imports) so the workflow can
 * use it directly.
 */
export function errorDetail(err: unknown): string {
  if (err instanceof Error) {
    if (err.cause instanceof Error) {
      return err.cause.message
    }
    return err.message
  }
  return String(err)
}
