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

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  )
}
