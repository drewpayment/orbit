import crypto from 'crypto'

const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET!

if (!WEBHOOK_SECRET) {
  throw new Error('GITHUB_APP_WEBHOOK_SECRET environment variable required')
}

/**
 * Verify GitHub webhook signature
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!signature) {
    return false
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  const digest = 'sha256=' + hmac.update(payload).digest('hex')

  const signatureBuffer = Buffer.from(signature)
  const digestBuffer = Buffer.from(digest)

  // timingSafeEqual throws if the buffers differ in length, so a malformed
  // signature header would otherwise crash the webhook (→ 500 → GitHub retries).
  // A length mismatch can only mean the signature is invalid.
  if (signatureBuffer.length !== digestBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(signatureBuffer, digestBuffer)
}
