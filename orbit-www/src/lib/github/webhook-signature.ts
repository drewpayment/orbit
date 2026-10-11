import crypto from 'crypto'

/**
 * Constant-time check of a GitHub `X-Hub-Signature-256` header against a
 * per-document webhook secret. Never throws: a malformed or wrong-length
 * signature is simply invalid (raw `timingSafeEqual` throws on length mismatch).
 */
export function verifyHmacSha256(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'))
  const supplied = Buffer.from(signature)
  if (expected.length !== supplied.length) return false
  return crypto.timingSafeEqual(expected, supplied)
}

/**
 * Keep only the candidates whose own `webhookSecret` validates the signature.
 *
 * Webhook routes look candidates up by repository name (attacker-controlled
 * payload field) BEFORE they can know the request is genuine, so callers must
 * filter through this and act only on the verified subset. When the result is
 * empty, respond with a generic 401 that reveals nothing about which apps or
 * templates exist, which have secrets, or why verification failed.
 */
export function filterVerified<T extends { webhookSecret?: string | null }>(
  candidates: readonly T[],
  body: string,
  signature: string,
  /**
   * Resolves the plaintext HMAC secret for a candidate. Webhook secrets are
   * encrypted at rest, so routes pass a resolver that decrypts; returning
   * null/'' (e.g. undecryptable ciphertext) makes that candidate fail
   * verification — it is never skipped past verification.
   */
  resolveSecret: (candidate: T) => string | null | undefined = (c) => c.webhookSecret,
): T[] {
  return candidates.filter((c) => {
    const secret = resolveSecret(c)
    return !!secret && verifyHmacSha256(body, signature, secret)
  })
}
