export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/authz'
import { approveTopic } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * POST /api/kafka/topics/[id]/approve
 * Approve a pending Kafka topic
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
  const result = await approveTopic(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    topic: result.topic,
    workflowId: result.workflowId,
  })
}
