import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { checkSchemaCompatibility } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * POST /api/kafka/schemas/compatibility
 * Check if a schema is compatible with existing schemas
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

    const result = await checkSchemaCompatibility({
      topicId,
      type,
      format,
      content,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ compatible: result.compatible })
  } catch (error) {
    console.error('[POST /api/kafka/schemas/compatibility] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check compatibility' },
      { status: 500 }
    )
  }
}
