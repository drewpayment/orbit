export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { deleteCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

/**
 * DELETE /api/kafka/admin/clusters/[id]
 * Delete a Kafka cluster (admin only)
 */
export async function DELETE(
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
  const result = await deleteCluster(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
