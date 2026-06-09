export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { createInstallationToken } from '@/lib/github/octokit'
import { encrypt } from '@/lib/encryption'

/**
 * Terminal failures cannot be fixed by retrying — they require a human to
 * reconnect the GitHub App. We signal them with a distinct HTTP status + code
 * so the Temporal activity client can mark the workflow error non-retryable
 * and the workflow can escalate the installation to `needs_reconnect`.
 *
 * Anything else (5xx, network) is transient and should be retried.
 */
function terminalResponse(code: string, message: string, httpStatus: number) {
  return NextResponse.json(
    { Success: false, ExpiresAt: new Date().toISOString(), ErrorMessage: message, code, terminal: true },
    { status: httpStatus }
  )
}

export async function POST(request: NextRequest) {
  let installationId: string | undefined
  try {
    ;({ installationId } = await request.json())
  } catch {
    return terminalResponse('BAD_REQUEST', 'invalid JSON body', 400)
  }

  if (!installationId) {
    return terminalResponse('BAD_REQUEST', 'installationId required', 400)
  }

  const payload = await getPayload({ config: configPromise })

  const installation = await payload.findByID({
    collection: 'github-installations',
    id: installationId,
  })

  if (!installation) {
    // Installation row is gone — nothing to refresh, never will be.
    return terminalResponse('INSTALLATION_NOT_FOUND', 'Installation not found', 404)
  }

  // 1. Mint a fresh token from GitHub. GitHub errors carry an HTTP status we can classify.
  let token: string
  let expiresAt: Date
  try {
    ;({ token, expiresAt } = await createInstallationToken(installation.installationId))
  } catch (error) {
    const status = (error as { status?: number })?.status
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Temporal Activity] createInstallationToken failed:', status, message)

    // 404: installation deleted on GitHub. 401/403: app deauthorized / credentials revoked.
    if (status === 404) {
      return terminalResponse('INSTALLATION_GONE', `GitHub installation gone: ${message}`, 404)
    }
    if (status === 401 || status === 403) {
      return terminalResponse('BAD_CREDENTIALS', `GitHub auth failed: ${message}`, 401)
    }
    // 5xx / rate-limit / network: transient, let Temporal retry.
    return NextResponse.json(
      { Success: false, ExpiresAt: new Date().toISOString(), ErrorMessage: message, terminal: false },
      { status: 502 }
    )
  }

  // 2. Encrypt with the current key. A failure here means a key/config problem
  //    that retrying will not fix (e.g. ENCRYPTION_KEY rotated) — terminal.
  let encryptedToken: string
  try {
    encryptedToken = encrypt(token)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Temporal Activity] token encryption failed:', message)
    return terminalResponse('ENCRYPTION_FAILED', `Token encryption failed: ${message}`, 422)
  }

  // 3. Persist the fresh token.
  await payload.update({
    collection: 'github-installations',
    id: installationId,
    data: {
      installationToken: encryptedToken,
      tokenExpiresAt: expiresAt.toISOString(),
      tokenLastRefreshedAt: new Date().toISOString(),
      status: 'active',
      temporalWorkflowStatus: 'running',
    },
  })

  return NextResponse.json({
    Success: true,
    ExpiresAt: expiresAt.toISOString(),
    ErrorMessage: '',
  })
}
