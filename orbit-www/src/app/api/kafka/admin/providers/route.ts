export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { listProviders } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { authorize, authzErrorResponse } from '@/lib/authz'

/**
 * GET /api/kafka/admin/providers
 * List available Kafka providers (admin only)
 */
export async function GET() {
  try {
    await authorize('manage', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const result = await listProviders()

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ providers: result.providers })
}
