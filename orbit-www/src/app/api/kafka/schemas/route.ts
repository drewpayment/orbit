import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { registerSchema, listSchemas } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/schemas
 * List schemas for a topic
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const topicId = searchParams.get('topicId')

  if (!topicId) {
    return NextResponse.json({ error: 'topicId is required' }, { status: 400 })
  }

  const result = await listSchemas(topicId)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ schemas: result.schemas })
}

/**
 * POST /api/kafka/schemas
 * Register a new schema for a topic
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

    const { topicId, type, format, content } = body
    if (!topicId || !type || !format || !content) {
      return NextResponse.json(
        { error: 'topicId, type, format, and content are required' },
        { status: 400 }
      )
    }

    const result = await registerSchema({
      topicId,
      type,
      format,
      content,
      compatibility: body.compatibility,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ schema: result.schema })
  } catch (error) {
    console.error('[POST /api/kafka/schemas] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to register schema' },
      { status: 500 }
    )
  }
}
