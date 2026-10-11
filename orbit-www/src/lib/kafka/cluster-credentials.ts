import { readSecretJson } from '@/lib/encryption/secret-fields'

/**
 * `kafka-clusters.credentials` is stored as AES-256-GCM ciphertext of a JSON
 * object (see KafkaClusters collection) and is never returned by the Payload
 * REST/GraphQL API. Trusted server code that must hand the real credentials to
 * the Go services (internal routes, validateCluster) reads the doc with
 * `overrideAccess: true` and passes it through here.
 *
 * Returns a copy with `credentials` decrypted back to its object form. Throws
 * if the stored value is ciphertext that cannot be decrypted — callers must
 * fail the request rather than forward unverified data.
 */
export function revealClusterCredentials<T extends object>(cluster: T): T {
  const stored = (cluster as { credentials?: unknown }).credentials
  if (stored === undefined || stored === null) return cluster
  // Empty (`{}`, nothing registered) stays as-is; legacy plaintext objects are
  // tolerated until migrated; ciphertext that cannot be decrypted throws.
  const revealed = readSecretJson<Record<string, unknown>>(stored, 'kafka-clusters.credentials')
  return { ...cluster, credentials: revealed ?? stored }
}

/** Config keys that carry secrets (sasl.password, ssl.key.password, api.secret, ...). */
const SECRET_CONFIG_KEY = /(password|passwd|secret|token|api[._-]?key|private[._-]?key|credential|jaas|keystore|truststore|\.key$)/i

export function isSecretConfigKey(key: string): boolean {
  return SECRET_CONFIG_KEY.test(key)
}

/**
 * Split caller-supplied free-form cluster config into non-secret
 * `connectionConfig` entries (stored in plaintext, shown in the UI) and
 * secret-looking entries, which must go into the encrypted `credentials`.
 */
export function splitClusterConfig(config: Record<string, string> | undefined): {
  plain: Record<string, string>
  secret: Record<string, string>
} {
  const plain: Record<string, string> = {}
  const secret: Record<string, string> = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    ;(isSecretConfigKey(key) ? secret : plain)[key] = value
  }
  return { plain, secret }
}
