import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'crypto'

// The module reads GITHUB_APP_WEBHOOK_SECRET at import time and throws if unset.
beforeAll(() => {
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'test-webhook-secret'
})

function sign(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

describe('verifyWebhookSignature', () => {
  it('returns true for a correctly signed payload', async () => {
    const { verifyWebhookSignature } = await import('./webhooks')
    const payload = JSON.stringify({ action: 'created' })
    expect(verifyWebhookSignature(payload, sign(payload, 'test-webhook-secret'))).toBe(true)
  })

  it('returns false for a wrong signature of the same length', async () => {
    const { verifyWebhookSignature } = await import('./webhooks')
    const payload = JSON.stringify({ action: 'created' })
    const wrong = sign(payload, 'a-different-secret')
    expect(verifyWebhookSignature(payload, wrong)).toBe(false)
  })

  it('returns false (does NOT throw) for a malformed, wrong-length signature', async () => {
    const { verifyWebhookSignature } = await import('./webhooks')
    const payload = JSON.stringify({ action: 'created' })
    // 'sha256=tooshort' is far shorter than a real 64-hex-char digest.
    expect(() => verifyWebhookSignature(payload, 'sha256=tooshort')).not.toThrow()
    expect(verifyWebhookSignature(payload, 'sha256=tooshort')).toBe(false)
  })

  it('returns false for an empty signature', async () => {
    const { verifyWebhookSignature } = await import('./webhooks')
    expect(verifyWebhookSignature('{}', '')).toBe(false)
  })
})
