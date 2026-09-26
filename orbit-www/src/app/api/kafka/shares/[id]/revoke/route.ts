export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/authz'
import { revokeTopicAccess } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * POST /api/kafka/shares/[id]/revoke
 * Revoke topic access
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor()

  if (!actor) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { id } = await params
  const result = await revokeTopicAccess(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
