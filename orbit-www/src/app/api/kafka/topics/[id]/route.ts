import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getTopic, updateTopic, deleteTopic, approveTopic } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/topics/[id]
 * Get a single Kafka topic by ID
 */
export async function GET(
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
  const result = await getTopic(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 404 })
  }

  return NextResponse.json({ topic: result.topic })
}

/**
 * PATCH /api/kafka/topics/[id]
 * Update a Kafka topic
 */
export async function PATCH(
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

  try {
    const body = await request.json()

    const result = await updateTopic({
      topicId: id,
      partitions: body.partitions,
      retentionMs: body.retentionMs,
      config: body.config,
      description: body.description,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ topic: result.topic })
  } catch (error) {
    console.error('[PATCH /api/kafka/topics/[id]] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update topic' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/kafka/topics/[id]
 * Delete a Kafka topic
 */
export async function DELETE(
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
  const result = await deleteTopic(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ workflowId: result.workflowId })
}
