export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { requestTopicAccess, listTopicShares } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/shares
 * List topic shares
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const topicId = searchParams.get('topicId') || undefined
  const workspaceId = searchParams.get('workspaceId') || undefined
  const status = searchParams.get('status') as
    | 'pending_request'
    | 'approved'
    | 'rejected'
    | 'revoked'
    | undefined

  const result = await listTopicShares({
    topicId,
    workspaceId,
    status,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ shares: result.shares })
}

/**
 * POST /api/kafka/shares
 * Request access to a topic
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

    const { topicId, requestingWorkspaceId, permission, justification } = body
    if (!topicId || !requestingWorkspaceId || !permission || !justification) {
      return NextResponse.json(
        { error: 'topicId, requestingWorkspaceId, permission, and justification are required' },
        { status: 400 }
      )
    }

    const result = await requestTopicAccess({
      topicId,
      requestingWorkspaceId,
      permission,
      justification,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ share: result.share })
  } catch (error) {
    console.error('[POST /api/kafka/shares] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to request access' },
      { status: 500 }
    )
  }
}
