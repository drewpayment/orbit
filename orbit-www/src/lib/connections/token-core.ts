import type { Payload } from 'payload'
import { decrypt as defaultDecrypt } from '@/lib/encryption'

/**
 * Testable core for `POST /api/internal/git-connections/token` (WP11/WP12) —
 * the git-connections analogue of the GitHub installation token route. The Go
 * catalog-scan worker calls it (X-API-Key) with a connection doc id and gets
 * back a ready-to-use credential plus the connection coordinates it needs to
 * talk to the provider's REST API (Azure DevOps today).
 *
 * Two auth modes (`git-connections.authType`):
 *  - `pat`               → authMode 'basic-pat', token = the decrypted PAT.
 *  - `service-principal` → authMode 'bearer', token = a short-lived Microsoft
 *    Entra access token minted via the OAuth2 client-credentials flow against
 *    the Azure DevOps resource scope. Nothing long-lived leaves this process;
 *    minted tokens are cached in-module until shortly before expiry.
 *
 * The decrypt and Entra-mint functions are injectable so the unit tests can
 * exercise the lookup/decrypt/mint/error matrix against a FakePayload without
 * a real ENCRYPTION_KEY or network. The route passes the real implementations.
 *
 * Error shape mirrors the GitHub token route:
 *  - 404 NOT_FOUND         — no connection with that id.
 *  - 410 NOT_CONFIGURED    — connection lacks the credentials its authType needs.
 *  - 500 DECRYPT_FAILED    — a stored secret could not be decrypted.
 *  - 502 ENTRA_AUTH_FAILED — Entra rejected the client-credentials request.
 */

/** Azure DevOps' first-party resource app id — the client-credentials scope. */
export const ADO_RESOURCE_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default'

export interface ConnectionTokenResponse {
  provider: string
  organization: string
  /** Empty string when the connection scans all projects in the org. */
  project: string
  baseUrl: string
  /** How the Go worker must present the token to the provider API. */
  authMode: 'basic-pat' | 'bearer'
  token: string
}

export type ConnectionTokenLookup =
  | { ok: true; body: ConnectionTokenResponse }
  | { ok: false; status: 404 | 410 | 500 | 502; code: string; error: string }

export interface EntraTokenResult {
  token: string
  /** Epoch ms when the token expires. */
  expiresAtMs: number
}

export type EntraTokenMinter = (
  tenantId: string,
  clientId: string,
  clientSecret: string,
) => Promise<EntraTokenResult>

/**
 * Default Entra minter: OAuth2 client-credentials against the tenant's v2
 * token endpoint, scoped to the Azure DevOps resource.
 */
export const mintEntraToken: EntraTokenMinter = async (tenantId, clientId, clientSecret) => {
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: ADO_RESOURCE_SCOPE,
      }),
    },
  )
  if (!res.ok) {
    // Entra error bodies carry no secrets; keep only the error code for the log.
    let code = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) code = `${code} ${body.error}`
    } catch {
      // non-JSON body — status alone is enough
    }
    throw new Error(`Entra token request failed: ${code}`)
  }
  const body = (await res.json()) as { access_token: string; expires_in: number }
  return { token: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 }
}

/** Refresh margin: treat tokens expiring within 5 minutes as expired. */
const ENTRA_CACHE_MARGIN_MS = 5 * 60 * 1000

/** Per-connection cache of minted Entra tokens (module lifetime). */
const entraTokenCache = new Map<string, EntraTokenResult>()

/** Test hook: clear the module-level Entra token cache. */
export function clearEntraTokenCache(): void {
  entraTokenCache.clear()
}

const DEFAULT_BASE_URL = 'https://dev.azure.com'

export async function resolveConnectionToken(
  payload: Payload,
  connectionId: string,
  decryptFn: (s: string) => string = defaultDecrypt,
  mintFn: EntraTokenMinter = mintEntraToken,
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
  const authType = typeof doc.authType === 'string' ? doc.authType : 'pat'
  const baseUrl =
    typeof doc.baseUrl === 'string' && doc.baseUrl.length > 0 ? doc.baseUrl : DEFAULT_BASE_URL
  const coordinates = {
    provider: typeof doc.provider === 'string' ? doc.provider : '',
    organization: typeof doc.organization === 'string' ? doc.organization : '',
    project: typeof doc.project === 'string' ? doc.project : '',
    baseUrl,
  }

  if (authType === 'service-principal') {
    const tenantId = typeof credentials.tenantId === 'string' ? credentials.tenantId : ''
    const clientId = typeof credentials.clientId === 'string' ? credentials.clientId : ''
    const encryptedSecret =
      typeof credentials.clientSecret === 'string' ? credentials.clientSecret : ''
    if (!tenantId || !clientId || !encryptedSecret) {
      return {
        ok: false,
        status: 410,
        code: 'NOT_CONFIGURED',
        error: 'Connection has no service principal configured',
      }
    }

    const cached = entraTokenCache.get(connectionId)
    if (cached && cached.expiresAtMs - ENTRA_CACHE_MARGIN_MS > Date.now()) {
      return { ok: true, body: { ...coordinates, authMode: 'bearer', token: cached.token } }
    }

    let clientSecret: string
    try {
      clientSecret = decryptFn(encryptedSecret)
    } catch {
      return { ok: false, status: 500, code: 'DECRYPT_FAILED', error: 'Failed to decrypt credentials' }
    }

    try {
      const minted = await mintFn(tenantId, clientId, clientSecret)
      entraTokenCache.set(connectionId, minted)
      return { ok: true, body: { ...coordinates, authMode: 'bearer', token: minted.token } }
    } catch (e) {
      return {
        ok: false,
        status: 502,
        code: 'ENTRA_AUTH_FAILED',
        error: e instanceof Error ? e.message : 'Entra token request failed',
      }
    }
  }

  // Default: PAT auth.
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

  return { ok: true, body: { ...coordinates, authMode: 'basic-pat', token: pat } }
}
