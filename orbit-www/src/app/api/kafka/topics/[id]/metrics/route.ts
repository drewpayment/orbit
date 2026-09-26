export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/authz'
import { getTopicMetrics } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/topics/[id]/metrics
 * Get metrics for a Kafka topic
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
  const { searchParams } = new URL(request.url)
  const periodType = searchParams.get('periodType') as 'hour' | 'day' | 'week' | 'month' | undefined
  const periods = searchParams.get('periods') ? parseInt(searchParams.get('periods')!) : undefined

  const result = await getTopicMetrics({
    topicId: id,
    periodType,
    periods,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ metrics: result.metrics })
}
