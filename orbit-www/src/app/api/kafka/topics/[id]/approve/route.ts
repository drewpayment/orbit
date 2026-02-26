export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { approveTopic } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * POST /api/kafka/topics/[id]/approve
 * Approve a pending Kafka topic
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
