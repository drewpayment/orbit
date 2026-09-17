export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { validateCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { authorize, authzErrorResponse } from '@/lib/authz'

/**
 * POST /api/kafka/admin/clusters/[id]/validate
 * Validate a Kafka cluster connection (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await authorize('manage', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const { id } = await params
  const result = await validateCluster(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ valid: result.valid })
}
