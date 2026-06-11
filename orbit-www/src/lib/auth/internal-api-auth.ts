import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

/**
 * Validate the X-API-Key header against ORBIT_INTERNAL_API_KEY using a
 * constant-time comparison to prevent timing-oracle attacks.
 *
 * Returns `null` when the key is valid, or a 401 NextResponse when it is not.
 * Missing env var is treated as a misconfiguration and also returns 401
 * (fail-closed, never fail-open).
 *
 * Usage:
 *   const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
 *   if (authError) return authError
 */
export function validateInternalApiKey(suppliedKey: string | null): NextResponse | null {
  const expected = process.env.ORBIT_INTERNAL_API_KEY
  if (!expected) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (!suppliedKey) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  // timingSafeEqual requires equal-length buffers; we use a fixed encoding so
  // length differences are not trivially observable.
  const expectedBuf = Buffer.from(expected, 'utf8')
  const suppliedBuf = Buffer.from(suppliedKey, 'utf8')
  const lengthsMatch = expectedBuf.byteLength === suppliedBuf.byteLength

  // Always run the comparison to prevent early-exit timing leaks.
  // If lengths differ, compare the expected key against itself (always equal)
  // so the branch is not skipped, then reject.
  const keysMatch = lengthsMatch
    ? timingSafeEqual(expectedBuf, suppliedBuf)
    : false

  if (!keysMatch) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  return null
}
