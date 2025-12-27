import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { discoverTopics } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/discover
 * Discover topics available to a workspace
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const requestingWorkspaceId = searchParams.get('requestingWorkspaceId')
  const environment = searchParams.get('environment') || undefined
  const search = searchParams.get('search') || undefined
  const schemaFormat = searchParams.get('schemaFormat') as 'avro' | 'protobuf' | 'json' | undefined
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined

  if (!requestingWorkspaceId) {
    return NextResponse.json({ error: 'requestingWorkspaceId is required' }, { status: 400 })
  }

  const result = await discoverTopics({
    requestingWorkspaceId,
    environment,
    search,
    schemaFormat,
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
