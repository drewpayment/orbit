import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApplicationFailure } from '@temporalio/activity'
import { dispatchScheduledAutomation } from './dispatch'
import type { AutomationDispatchInput } from '../shared'

/**
 * Activity dispatch tests (P4.2 hardening).
 *
 * The central invariant: a TERMINAL dispatch failure (4xx — e.g. invalid inputs
 * that can never succeed on retry) must surface as a non-retryable
 * {@link ApplicationFailure} so Temporal STOPS retrying, while transient
 * failures (5xx/network) stay plain retryable Errors.
 */

const input: AutomationDispatchInput = { automationId: 'a1', workspaceId: 'ws1' }

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

describe('dispatchScheduledAutomation', () => {
  it('resolves on a 2xx response', async () => {
    mockFetch(() => jsonResponse(200, { matched: 1, dispatched: 1 }))
    await expect(dispatchScheduledAutomation(input)).resolves.toBeUndefined()
  })

  it('throws a NON-retryable ApplicationFailure on a 4xx (terminal) response', async () => {
    mockFetch(() => jsonResponse(422, { error: '"Target" is required.', terminal: true }))

    const err = await dispatchScheduledAutomation(input).catch((e) => e)
    expect(err).toBeInstanceOf(ApplicationFailure)
    expect((err as ApplicationFailure).nonRetryable).toBe(true)
    // status + (raw JSON) body are carried in the message for operator
    // visibility — quotes are escaped in the serialized body.
    expect((err as Error).message).toContain('422')
    expect((err as Error).message).toContain('is required.')
    expect((err as Error).message).toContain('terminal')
  })

  it('throws a NON-retryable ApplicationFailure on any 4xx (e.g. 400)', async () => {
    mockFetch(() => jsonResponse(400, { error: 'bad request' }))
    const err = await dispatchScheduledAutomation(input).catch((e) => e)
    expect(err).toBeInstanceOf(ApplicationFailure)
    expect((err as ApplicationFailure).nonRetryable).toBe(true)
  })

  it('throws a plain (retryable) Error on a 5xx response — NOT an ApplicationFailure', async () => {
    mockFetch(() => jsonResponse(500, { error: 'kaboom' }))
    const err = await dispatchScheduledAutomation(input).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('500')
  })

  it('throws a retryable Error naming ORBIT_API_URL when it is missing', async () => {
    delete process.env.ORBIT_API_URL
    const fetchFn = mockFetch(() => jsonResponse(200, {}))
    const err = await dispatchScheduledAutomation(input).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('ORBIT_API_URL')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws a retryable Error naming ORBIT_INTERNAL_API_KEY when it is missing', async () => {
    delete process.env.ORBIT_INTERNAL_API_KEY
    const fetchFn = mockFetch(() => jsonResponse(200, {}))
    const err = await dispatchScheduledAutomation(input).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApplicationFailure)
    expect((err as Error).message).toContain('ORBIT_INTERNAL_API_KEY')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
