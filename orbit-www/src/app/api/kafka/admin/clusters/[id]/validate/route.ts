export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { validateCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * POST /api/kafka/admin/clusters/[id]/validate
 * Validate a Kafka cluster connection (admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // TODO: Verify platform admin role

  const { id } = await params
  const result = await validateCluster(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ valid: result.valid })
}
