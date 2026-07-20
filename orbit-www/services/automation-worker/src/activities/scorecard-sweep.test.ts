import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApplicationFailure } from '@temporalio/activity'
import {
  captureWorkspaceSnapshots,
  listEnabledScorecards,
  evaluateScorecard,
} from './scorecard-sweep'

/**
 * Scorecard-sweep activity tests. Mirrors the dispatch activity tests: a global
 * `fetch` stub + env save/restore, asserting the request shape and the error
 * semantics that Temporal's retry policy depends on — a TERMINAL failure (4xx)
 * surfaces as a non-retryable {@link ApplicationFailure} so Temporal STOPS, while
 * a transient failure (5xx/network) stays a plain retryable Error.
 */

function mockFetch(impl: () => Promise<Response> | Response) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  process.env.ORBIT_API_URL = 'http://orbit.test'
  process.env.ORBIT_INTERNAL_API_KEY = 'secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listEnabledScorecards', () => {
  it('GETs the /due route with the API key and parses the scorecards array', async () => {
    const fetchFn = mockFetch(() =>
      jsonResponse(200, {
        scorecards: [
          { id: 's1', workspaceId: 'ws1' },
          { id: 's2', workspaceId: 'ws2' },
        ],
      }),
    )

    const result = await listEnabledScorecards()

    expect(result).toEqual([
      { id: 's1', workspaceId: 'ws1' },
      { id: 's2', workspaceId: 'ws2' },
    ])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://orbit.test/api/internal/scorecards/due')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret')
  })

  it('returns an empty list when the route reports no scorecards', async () => {
    mockFetch(() => jsonResponse(200, { scorecards: [] }))
    await expect(listEnabledScorecards()).resolves.toEqual([])
  })

  it('tolerates a missing scorecards field by returning an empty list', async () => {
    mockFetch(() => jsonResponse(200, {}))
    await expect(listEnabledScorecards()).resolves.toEqual([])
  })

  it('throws a NON-retryable ApplicationFailure on a 4xx response', async () => {
    mockFetch(() => jsonResponse(403, { error: 'forbidden' }))
    const err = await listEnabledScorecards().catch((e) => e)
    expect(err).toBeInstanceOf(ApplicationFailure)
    expect((err as ApplicationFailure).nonRetryable).toBe(true)
    expect((err as Error).message).toContain('403')
  })

  it('throws a plain (retryable) Error on a 5xx response', async () => {
    mockFetch(() => jsonResponse(500, { error: 'kaboom' }))
    const err = await listEnabledScorecards().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('500')
  })

  it('throws a retryable Error naming ORBIT_API_URL when it is missing', async () => {
    delete process.env.ORBIT_API_URL
    const fetchFn = mockFetch(() => jsonResponse(200, { scorecards: [] }))
    const err = await listEnabledScorecards().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('ORBIT_API_URL')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws a retryable Error naming ORBIT_INTERNAL_API_KEY when it is missing', async () => {
    delete process.env.ORBIT_INTERNAL_API_KEY
    const fetchFn = mockFetch(() => jsonResponse(200, { scorecards: [] }))
    const err = await listEnabledScorecards().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('ORBIT_INTERNAL_API_KEY')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('evaluateScorecard', () => {
  it('POSTs the /evaluate route with the API key and a JSON body', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { ok: true }))

    await expect(evaluateScorecard({ scorecardId: 's1' })).resolves.toBeUndefined()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://orbit.test/api/internal/scorecards/evaluate')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('secret')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ scorecardId: 's1' })
  })

  it('can suppress per-scorecard snapshots for a workspace-coordinated sweep', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { ok: true }))

    await evaluateScorecard({ scorecardId: 's1', captureSnapshots: false })

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ scorecardId: 's1', captureSnapshots: false })
  })

  it('throws a NON-retryable ApplicationFailure on a 4xx response', async () => {
    mockFetch(() => jsonResponse(422, { error: 'bad scorecard' }))
    const err = await evaluateScorecard({ scorecardId: 's1' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApplicationFailure)
    expect((err as ApplicationFailure).nonRetryable).toBe(true)
    expect((err as Error).message).toContain('422')
    expect((err as Error).message).toContain('s1')
  })

  it('throws a plain (retryable) Error on a 5xx response', async () => {
    mockFetch(() => jsonResponse(503, { error: 'unavailable' }))
    const err = await evaluateScorecard({ scorecardId: 's1' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('503')
  })

  it('throws a retryable Error naming ORBIT_API_URL when it is missing', async () => {
    delete process.env.ORBIT_API_URL
    const fetchFn = mockFetch(() => jsonResponse(200, {}))
    const err = await evaluateScorecard({ scorecardId: 's1' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('ORBIT_API_URL')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws a retryable Error naming ORBIT_INTERNAL_API_KEY when it is missing', async () => {
    delete process.env.ORBIT_INTERNAL_API_KEY
    const fetchFn = mockFetch(() => jsonResponse(200, {}))
    const err = await evaluateScorecard({ scorecardId: 's1' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('ORBIT_INTERNAL_API_KEY')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('captureWorkspaceSnapshots', () => {
  it('forces one final snapshot after every scorecard in the workspace settles', async () => {
    const fetchFn = mockFetch(() => jsonResponse(200, { created: 3 }))

    await expect(
      captureWorkspaceSnapshots({ workspaceId: 'ws1', captureKey: 'workflow-1:ws1' }),
    ).resolves.toBeUndefined()

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://orbit.test/api/internal/scorecards/capture-snapshots')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      workspaceId: 'ws1',
      force: true,
      captureKey: 'workflow-1:ws1',
    })
  })
})
