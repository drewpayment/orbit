export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { resolveConnectionToken } from '@/lib/connections/token-core'

/**
 * POST /api/internal/git-connections/token — HTTP shell only; the lookup /
 * decrypt / error matrix lives in `@/lib/connections/token-core` (Next's
 * generated route types allow only HTTP-handler exports from route files).
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time), the
 * same guard as the GitHub token route. The decrypted PAT is returned ONLY to
 * the internal Go worker — it never crosses to the browser.
 *
 * Body:     { connectionId, workspaceId? }
 * Response: 200 { provider, organization, project, baseUrl, pat }
 *           404 { error, code: 'NOT_FOUND' }
 *           410 { error, code: 'NOT_CONFIGURED' }
 *           500 { error, code }
 *
 * workspaceId is optional and additive: when a caller passes it, the
 * connection must be authorized for that workspace (see
 * resolveConnectionToken's workspace-scoping check) or the route responds
 * 404 exactly as it would for an unknown connection id — this is what
 * stops a scaffolder run in workspace A from resolving workspace B's PAT.
 * Omitting workspaceId keeps the route's prior, unscoped behavior for
 * callers that have no workspace context (e.g. a global connection scan).
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const { connectionId, workspaceId } = await request.json()

    if (!connectionId || typeof connectionId !== 'string') {
      return NextResponse.json(
        { error: 'connectionId required', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }
    if (workspaceId !== undefined && typeof workspaceId !== 'string') {
      return NextResponse.json(
        { error: 'workspaceId must be a string', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const payload = await getPayload({ config: configPromise })
    const result = await resolveConnectionToken(
      payload,
      connectionId,
      undefined,
      undefined,
      typeof workspaceId === 'string' ? workspaceId : undefined,
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    }

    return NextResponse.json(result.body)
  } catch (error) {
    console.error('[Internal API] Connection token fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
