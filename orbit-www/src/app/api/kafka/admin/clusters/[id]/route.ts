export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { deleteCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { authorize, authzErrorResponse } from '@/lib/authz'

/**
 * DELETE /api/kafka/admin/clusters/[id]
 * Delete a Kafka cluster (admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await authorize('manage', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const { id } = await params
  const result = await deleteCluster(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
