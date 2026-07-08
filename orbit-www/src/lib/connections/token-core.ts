import type { Payload } from 'payload'
import { decrypt as defaultDecrypt } from '@/lib/encryption'

/**
 * Testable core for `POST /api/internal/git-connections/token` (WP11) — the
 * git-connections analogue of the GitHub installation token route. The Go
 * catalog-scan worker calls it (X-API-Key) with a connection doc id and gets
 * back the decrypted PAT plus the connection coordinates it needs to talk to
 * the provider's REST API (Azure DevOps today).
 *
 * The decrypt function is injectable so the unit tests can exercise the
 * lookup/decrypt/error matrix against a FakePayload without a real
 * ENCRYPTION_KEY. The route passes the real `lib/encryption` decrypt.
 *
 * Error shape mirrors the GitHub token route:
 *  - 404 NOT_FOUND      — no connection with that id.
 *  - 410 NOT_CONFIGURED — connection exists but has no PAT stored (unusable).
 *  - 500 DECRYPT_FAILED — the stored PAT could not be decrypted.
 */

export interface ConnectionTokenResponse {
  provider: string
  organization: string
  /** Empty string when the connection scans all projects in the org. */
  project: string
  baseUrl: string
  pat: string
}

export type ConnectionTokenLookup =
  | { ok: true; body: ConnectionTokenResponse }
  | { ok: false; status: 404 | 410 | 500; code: string; error: string }

const DEFAULT_BASE_URL = 'https://dev.azure.com'

export async function resolveConnectionToken(
  payload: Payload,
  connectionId: string,
  decryptFn: (s: string) => string = defaultDecrypt,
): Promise<ConnectionTokenLookup> {
  let doc: Record<string, unknown> | null
  try {
    doc = (await payload.findByID({
      collection: 'git-connections',
      id: connectionId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
  } catch {
    doc = null
  }

  if (!doc) {
    return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Connection not found' }
  }

  const credentials = (doc.credentials ?? {}) as Record<string, unknown>
  const encryptedPat = typeof credentials.pat === 'string' ? credentials.pat : ''
  if (!encryptedPat) {
    return {
      ok: false,
      status: 410,
      code: 'NOT_CONFIGURED',
      error: 'Connection has no credentials configured',
    }
  }

  let pat: string
  try {
    pat = decryptFn(encryptedPat)
  } catch {
    return { ok: false, status: 500, code: 'DECRYPT_FAILED', error: 'Failed to decrypt credentials' }
  }

  const baseUrl =
    typeof doc.baseUrl === 'string' && doc.baseUrl.length > 0 ? doc.baseUrl : DEFAULT_BASE_URL

  return {
    ok: true,
    body: {
      provider: typeof doc.provider === 'string' ? doc.provider : '',
      organization: typeof doc.organization === 'string' ? doc.organization : '',
      project: typeof doc.project === 'string' ? doc.project : '',
      baseUrl,
      pat,
    },
  }
}
