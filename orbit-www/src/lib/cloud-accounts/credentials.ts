import { readSecretJson } from '@/lib/encryption/secret-fields'

/**
 * `cloud-accounts.credentials` is stored as AES-256-GCM ciphertext of a JSON
 * object and is never returned by the Payload REST/GraphQL API (see the
 * CloudAccounts collection). Server code that needs the real values calls
 * `revealCloudCredentials`; anything that crosses to the browser goes through
 * `publicCloudAccount`.
 */

/** Non-secret identifiers per provider that the settings UI may display. */
const PUBLIC_FIELDS: Record<string, string[]> = {
  azure: ['tenantId', 'clientId'],
  digitalocean: [],
}

/**
 * Decrypt stored credentials. Throws if the ciphertext cannot be decrypted;
 * not-yet-migrated legacy plaintext is returned as-is.
 */
export function revealCloudCredentials(stored: unknown): Record<string, unknown> | null {
  return readSecretJson<Record<string, unknown>>(stored, 'cloud-accounts.credentials')
}

/**
 * Copy of a cloud-account doc that is safe to send to the client: credentials
 * are reduced to the provider's non-secret identifiers. An unreadable stored
 * value yields `{}` rather than throwing or leaking.
 */
export function publicCloudAccount<T extends { provider?: unknown; credentials?: unknown }>(
  doc: T,
): Omit<T, 'credentials'> & { credentials: Record<string, unknown> } {
  let revealed: Record<string, unknown> | null = null
  try {
    revealed = revealCloudCredentials(doc.credentials)
  } catch {
    revealed = null
  }
  const allowed = PUBLIC_FIELDS[String(doc.provider)] ?? []
  const credentials: Record<string, unknown> = {}
  for (const key of allowed) {
    if (revealed && key in revealed) credentials[key] = revealed[key]
  }
  return { ...doc, credentials }
}

/**
 * Merge an edit into the stored credentials. Blank values mean "keep what is
 * stored" (the settings form never pre-fills secrets, so an untouched secret
 * input arrives as ''); only non-empty values replace stored ones.
 */
export function mergeCredentialUpdate(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === '' || value === null || value === undefined) continue
    merged[key] = value
  }
  return merged
}
