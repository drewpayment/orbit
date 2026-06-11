export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { validateCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

/**
 * POST /api/kafka/admin/clusters/[id]/validate
 * Validate a Kafka cluster connection (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!isPlatformAdmin(payloadUser)) {
    return NextResponse.json({ error: 'Forbidden: platform admin required' }, { status: 403 })
  }

  const { id } = await params
  const result = await validateCluster(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ valid: result.valid })
}
