export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { authorize, authzErrorResponse } from '@/lib/authz'
import { stripInstallationToken } from '@/lib/github/installation-sanitize'

// GitHub installations are platform-admin resources (same rule as the
// /settings/connections server actions). Both handlers previously had NO auth:
// GET leaked the encrypted installation token and PATCH accepted an arbitrary
// body (status, installationToken, allowedWorkspaces).

// Payload workspace ids are 24-char hex ObjectIds.
const WORKSPACE_ID = /^[a-f0-9]{24}$/i

async function requirePlatformAdmin(): Promise<NextResponse | null> {
  try {
    await authorize('manage', { kind: 'platform' })
    return null
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePlatformAdmin()
  if (denied) return denied

  const { id } = await params
  const payload = await getPayload({ config: configPromise })

  let installation
  try {
    installation = await payload.findByID({ collection: 'github-installations', id })
  } catch {
    return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
  }
  if (!installation) {
    return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
  }

  return NextResponse.json(stripInstallationToken(installation))
}

/**
 * Only `allowedWorkspaces` is client-writable. Status and token fields are
 * owned by the refresh workflow / install callback.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePlatformAdmin()
  if (denied) return denied

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : []
  const allowed = (body as { allowedWorkspaces?: unknown } | null)?.allowedWorkspaces
  if (
    keys.length !== 1 ||
    keys[0] !== 'allowedWorkspaces' ||
    !Array.isArray(allowed) ||
    !allowed.every((w) => typeof w === 'string' && WORKSPACE_ID.test(w))
  ) {
    return NextResponse.json(
      { error: 'Body must be exactly { allowedWorkspaces: string[] } with valid workspace ids' },
      { status: 400 }
    )
  }

  const payload = await getPayload({ config: configPromise })

  try {
    await payload.findByID({ collection: 'github-installations', id, depth: 0 })
  } catch {
    return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
  }

  try {
    const updated = await payload.update({
      collection: 'github-installations',
      id,
      data: { allowedWorkspaces: allowed as string[] } as never,
    })
    return NextResponse.json(stripInstallationToken(updated))
  } catch (error) {
    // Payload ValidationError (e.g. a workspace id that doesn't exist) is the caller's fault.
    const e = error as { name?: string; status?: number }
    if (e?.name === 'ValidationError' || e?.status === 400) {
      return NextResponse.json({ error: 'Invalid allowedWorkspaces' }, { status: 400 })
    }
    console.error('[GitHub Installation PATCH] Update failed:', error)
    return NextResponse.json({ error: 'Failed to update installation' }, { status: 500 })
  }
}
