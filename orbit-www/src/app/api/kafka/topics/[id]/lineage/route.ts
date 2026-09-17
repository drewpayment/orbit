export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/authz'
import { getTopicLineage } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/topics/[id]/lineage
 * Get lineage (producers/consumers) for a Kafka topic
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor()

  if (!actor) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { id } = await params
  const result = await getTopicLineage(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    producers: result.producers,
    consumers: result.consumers,
  })
}
