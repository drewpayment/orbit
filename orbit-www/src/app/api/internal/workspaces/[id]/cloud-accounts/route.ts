export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * GET /api/internal/workspaces/[id]/cloud-accounts
 *
 * Returns sanitized summaries of every cloud account connected to the
 * workspace. Used by the Infrastructure Agent (orbit_list_cloud_accounts).
 * The `credentials` field is intentionally NEVER returned — credentials
 * reach the sandbox only as env vars projected at pod start.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'workspace id required' }, { status: 400 })

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'cloud-accounts',
      where: { workspaces: { equals: id } },
      limit: 50,
      depth: 0,
      overrideAccess: true,
    })

    const accounts = result.docs.map((acc) => ({
      id: acc.id,
      name: acc.name,
      provider: (acc as { provider?: string }).provider ?? 'unknown',
      region: (acc as { region?: string }).region ?? '',
      status: (acc as { status?: string }).status ?? 'unknown',
      lastValidatedAt: (acc as { lastValidatedAt?: string }).lastValidatedAt ?? null,
    }))

    return NextResponse.json({ accounts })
  } catch (err) {
    console.error('[internal/workspaces/cloud-accounts] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
