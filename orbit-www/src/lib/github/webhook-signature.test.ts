/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifyHmacSha256, filterVerified } from './webhook-signature'

const sign = (body: string, secret: string) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')

describe('verifyHmacSha256', () => {
  it('accepts a correct signature', () => {
    expect(verifyHmacSha256('{}', sign('{}', 's'), 's')).toBe(true)
  })
  it('rejects a wrong secret, wrong body, and malformed/short signatures without throwing', () => {
    expect(verifyHmacSha256('{}', sign('{}', 'other'), 's')).toBe(false)
    expect(verifyHmacSha256('{"a":1}', sign('{}', 's'), 's')).toBe(false)
    expect(verifyHmacSha256('{}', 'sha256=abc', 's')).toBe(false)
    expect(verifyHmacSha256('{}', '', 's')).toBe(false)
  })
})

describe('filterVerified', () => {
  it('keeps only candidates whose own secret verifies; drops missing secrets', () => {
    const body = '{"x":1}'
    const sig = sign(body, 'a')
    const out = filterVerified(
      [
        { id: 1, webhookSecret: 'a' },
        { id: 2, webhookSecret: 'b' },
        { id: 3, webhookSecret: null },
        { id: 4 },
      ],
      body,
      sig,
    )
    expect(out.map((o) => o.id)).toEqual([1])
  })
})
