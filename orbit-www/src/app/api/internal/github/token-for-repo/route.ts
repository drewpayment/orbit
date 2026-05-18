export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { decrypt } from '@/lib/encryption'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

// POST /api/internal/github/token-for-repo
//
// Resolves a fresh installation token for {workspaceId, owner} so the
// agent's orbit_repo_clone tool can clone a private repo connected via
// the workspace's GitHub App installation. Companion to the
// installationId-keyed `/api/internal/github/token` route — this one is
// keyed by what the agent actually knows (the workspace it's running in
// and the org/owner of the repo it wants).
//
// The repo name itself isn't strictly needed to mint the token (tokens
// are installation-scoped, not repo-scoped) but callers pass it for
// audit/log context.
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }

  let body: { workspaceId?: unknown; owner?: unknown; repo?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    )
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
  const owner = typeof body.owner === 'string' ? body.owner.trim() : ''
  if (!workspaceId || !owner) {
    return NextResponse.json(
      { error: 'workspaceId and owner required', code: 'BAD_REQUEST' },
      { status: 400 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })

    // Fetch all active installations the workspace can use. Owner match
    // is done in JS so we can compare case-insensitively (GitHub org
    // logins are case-insensitive in URLs but stored canonically).
    const installations = await payload.find({
      collection: 'github-installations',
      where: {
        and: [
          { allowedWorkspaces: { contains: workspaceId } },
          { status: { equals: 'active' } },
        ],
      },
      limit: 50,
      overrideAccess: true,
    })

    const ownerLower = owner.toLowerCase()
    const match = installations.docs.find(
      (doc) => typeof doc.accountLogin === 'string' && doc.accountLogin.toLowerCase() === ownerLower,
    )

    if (!match) {
      return NextResponse.json(
        {
          error: `No active GitHub installation for owner "${owner}" connected to this workspace`,
          code: 'NOT_FOUND',
        },
        { status: 404 },
      )
    }

    const expiresAt = new Date(match.tokenExpiresAt)
    if (expiresAt <= new Date()) {
      return NextResponse.json(
        {
          error: 'Token expired, refresh workflow may be stalled',
          code: 'EXPIRED',
          installationId: match.installationId,
        },
        { status: 410 },
      )
    }

    const decryptedToken = decrypt(match.installationToken)

    return NextResponse.json({
      token: decryptedToken,
      expiresAt: match.tokenExpiresAt,
      installationId: match.installationId,
      accountLogin: match.accountLogin,
    })
  } catch (error) {
    console.error('[Internal API] token-for-repo error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
