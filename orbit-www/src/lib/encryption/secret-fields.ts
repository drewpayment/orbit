import type { FieldAccess, FieldHook } from 'payload'
import { encrypt, decrypt } from './index'

/**
 * Helpers for secret-bearing Payload fields (credentials, API keys, webhook
 * secrets, tokens). Every such field must:
 *
 *   1. be encrypted at rest — a field-level beforeChange hook;
 *   2. never be returned to REST/GraphQL callers — `secretFieldAccess`
 *      (field-level `read: () => false`; trusted server code that needs the
 *      value reads with `overrideAccess: true` and the `readSecret*` helpers);
 *   3. fail closed when a stored ciphertext cannot be decrypted.
 *
 * Stored formats (envelope = `iv:authTag:ciphertext`, hex, as produced by
 * `lib/encryption`):
 *   - text fields: the envelope string itself;
 *   - json fields: `{ enc: <envelope> }`. Payload JSON.parses string values of
 *     json fields during validation, so a bare envelope string would be
 *     rejected; an object wrapper passes through untouched.
 *
 * Rollout tolerance: a stored value that is NOT an envelope/wrapper is treated
 * as legacy plaintext by the `readSecret*` helpers (warned about once, fixed
 * by the next write or by `migrate-encrypt-secrets`). A value that IS an
 * envelope but fails to decrypt is always an error.
 *
 * Anti-oracle: the write hooks only keep a caller-supplied envelope if it is
 * identical to the value already stored. Anything else is encrypted again, so
 * a writer can never plant someone else's ciphertext in a field and have the
 * server decrypt it for them.
 */

// iv is 16 bytes (32 hex) from lib/encryption; accept 12-byte (24 hex) GCM
// nonces too so values written by other producers are never double-encrypted.
const ENVELOPE = /^[0-9a-f]{24,32}:[0-9a-f]{32}:[0-9a-f]*$/

export function isEncryptedEnvelope(value: unknown): value is string {
  return typeof value === 'string' && ENVELOPE.test(value)
}

export interface EncryptedJson {
  enc: string
}

export function isEncryptedJson(value: unknown): value is EncryptedJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'enc' && isEncryptedEnvelope((value as EncryptedJson).enc)
}

function isEmptySecret(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  return (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  )
}

// ---------------------------------------------------------------------------
// Write side
// ---------------------------------------------------------------------------

/**
 * Encrypt a text secret for storage. Empty values are returned unchanged. An
 * envelope is kept as-is ONLY when it equals `previousValue` (the value already
 * stored); a different envelope is treated as plaintext and encrypted again.
 * Pass `trustEnvelope` for fields whose server-side writers pre-encrypt.
 */
export function encryptSecretValue(
  value: unknown,
  previousValue?: unknown,
  opts: { trustEnvelope?: boolean } = {},
): unknown {
  if (isEmptySecret(value)) return value
  if (isEncryptedEnvelope(value) && (opts.trustEnvelope || value === previousValue)) return value
  return encrypt(typeof value === 'string' ? value : JSON.stringify(value))
}

/** Same as `encryptSecretValue` for json fields; stores `{ enc: envelope }`. */
export function encryptSecretJson(value: unknown, previousValue?: unknown): unknown {
  if (isEmptySecret(value)) return value
  if (isEncryptedJson(value) && isEncryptedJson(previousValue) && value.enc === previousValue.enc) {
    return value
  }
  return { enc: encrypt(JSON.stringify(value)) } satisfies EncryptedJson
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

const warned = new Set<string>()
function warnLegacyOnce(label: string): void {
  if (warned.has(label)) return
  warned.add(label)
  console.warn(
    `[secrets] ${label} holds an unencrypted legacy value; it will be encrypted on next save. ` +
      'Run the migrate-encrypt-secrets script.',
  )
}

/** Strict: throws unless `stored` is a valid envelope that decrypts. */
export function decryptSecretString(stored: unknown): string {
  if (!isEncryptedEnvelope(stored)) {
    throw new Error('Stored secret is not encrypted; run migrate-encrypt-secrets')
  }
  return decrypt(stored)
}

/** Strict json variant: accepts `{ enc }`, throws otherwise. */
export function decryptSecretJson<T = Record<string, unknown>>(stored: unknown): T {
  if (!isEncryptedJson(stored)) {
    throw new Error('Stored secret is not encrypted; run migrate-encrypt-secrets')
  }
  return JSON.parse(decrypt(stored.enc)) as T
}

/**
 * Rollout-tolerant read of a text secret. Envelope -> decrypted (throws if it
 * cannot be); empty -> null; anything else -> legacy plaintext, returned as-is.
 */
export function readSecretString(stored: unknown, label = 'secret'): string | null {
  if (isEmptySecret(stored)) return null
  if (isEncryptedEnvelope(stored)) return decrypt(stored)
  if (typeof stored !== 'string') throw new Error(`${label}: unexpected stored secret type`)
  warnLegacyOnce(label)
  return stored
}

/**
 * Rollout-tolerant read of a json secret. `{ enc }` -> decrypted object (throws
 * if it cannot be); empty -> null; a plain object -> legacy plaintext.
 */
export function readSecretJson<T = Record<string, unknown>>(stored: unknown, label = 'secret'): T | null {
  if (isEmptySecret(stored)) return null
  if (isEncryptedJson(stored)) return decryptSecretJson<T>(stored)
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    warnLegacyOnce(label)
    return stored as T
  }
  throw new Error(`${label}: unexpected stored secret type`)
}

/**
 * Non-throwing text read for request paths that must reject rather than 500
 * (webhook HMAC verification): null means "unusable, treat as failure".
 */
export function tryReadSecretString(stored: unknown, label = 'secret'): string | null {
  try {
    return readSecretString(stored, label)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Payload field config
// ---------------------------------------------------------------------------

/** Field-level access: no REST/GraphQL caller ever receives the field. */
export const secretFieldAccess: { read: FieldAccess } = {
  read: () => false,
}

const encryptText: FieldHook = ({ value, previousValue }) => encryptSecretValue(value, previousValue)
const encryptTextPreEncrypted: FieldHook = ({ value, previousValue }) =>
  encryptSecretValue(value, previousValue, { trustEnvelope: true })
const encryptJson: FieldHook = ({ value, previousValue }) => encryptSecretJson(value, previousValue)

/** text fields: encrypt on every create/update that carries a value. */
export const secretFieldHooks: { beforeChange: FieldHook[] } = { beforeChange: [encryptText] }

/** json fields: stores `{ enc }` so Payload's JSON validation still passes. */
export const secretJsonFieldHooks: { beforeChange: FieldHook[] } = { beforeChange: [encryptJson] }

/**
 * Only for fields whose trusted server-side writers already encrypt before
 * saving (github-installations.installationToken: install callback + refresh
 * route). Collection write access is admin-only, so envelope pass-through is
 * acceptable there.
 */
export const secretFieldHooksPreEncrypted: { beforeChange: FieldHook[] } = {
  beforeChange: [encryptTextPreEncrypted],
}
