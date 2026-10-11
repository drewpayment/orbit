import { NextResponse } from 'next/server'

/**
 * Test double for `@/lib/authz` used by Route Handler tests:
 *
 *   const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
 *   vi.mock('@/lib/authz', async () => (await import('@/lib/authz/route-test-utils')).makeAuthzMock(mocks))
 *
 * Provides real-shaped 401/403 mapping (same bodies as `authzErrorResponse`)
 * without pulling in Payload or Better-Auth.
 */
export class FakeUnauthenticatedError extends Error {
  readonly status = 401
}
export class FakeAuthzError extends Error {
  readonly status = 403
  readonly decision = { allowed: false, reason: 'denied' }
}

export function makeAuthzMock(fns: Record<string, unknown>) {
  return {
    ...fns,
    UnauthenticatedError: FakeUnauthenticatedError,
    AuthzError: FakeAuthzError,
    authzErrorResponse: (err: unknown) => {
      if (err instanceof FakeUnauthenticatedError) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
      }
      if (err instanceof FakeAuthzError) {
        return NextResponse.json({ error: 'Forbidden', reason: err.decision.reason }, { status: 403 })
      }
      return null
    },
  }
}
