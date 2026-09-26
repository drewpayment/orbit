export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/authz'
import { revokeServiceAccount } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * POST /api/kafka/service-accounts/[id]/revoke
 * Revoke a service account
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
  const result = await revokeServiceAccount(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
