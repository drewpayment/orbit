import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { createTopic, listTopics } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/topics
 * List Kafka topics for a workspace
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')
  const environment = searchParams.get('environment') || undefined
  const status = searchParams.get('status') || undefined
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const result = await listTopics({
    workspaceId,
    environment,
    status,
    limit,
    offset,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    topics: result.topics,
    total: result.total,
  })
}

/**
 * POST /api/kafka/topics
 * Create a new Kafka topic
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json()

    const { workspaceId, name, environment } = body
    if (!workspaceId || !name || !environment) {
      return NextResponse.json(
        { error: 'workspaceId, name, and environment are required' },
        { status: 400 }
      )
    }

    const result = await createTopic({
      workspaceId,
      name,
      environment,
      partitions: body.partitions,
      replicationFactor: body.replicationFactor,
      retentionMs: body.retentionMs,
      cleanupPolicy: body.cleanupPolicy,
      compression: body.compression,
      config: body.config,
      description: body.description,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      topic: result.topic,
      workflowId: result.workflowId,
    })
  } catch (error) {
    console.error('[POST /api/kafka/topics] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create topic' },
      { status: 500 }
    )
  }
}
