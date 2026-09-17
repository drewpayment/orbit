export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listClusters, registerCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { authorize, authzErrorResponse } from '@/lib/authz'

/**
 * GET /api/kafka/admin/clusters
 * List Kafka clusters (admin only)
 */
export async function GET() {
  try {
    await authorize('manage', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const result = await listClusters()

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ clusters: result.clusters })
}

/**
 * POST /api/kafka/admin/clusters
 * Register a new Kafka cluster (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    await authorize('manage', { kind: 'platform' })
  } catch (err) {
    return authzErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  try {
    const body = await request.json()

    const { name, providerId, connectionConfig, credentials } = body
    if (!name || !providerId || !connectionConfig) {
      return NextResponse.json(
        { error: 'name, providerId, and connectionConfig are required' },
        { status: 400 }
      )
    }

    const result = await registerCluster({
      name,
      providerId,
      connectionConfig,
      credentials: credentials || {},
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ cluster: result.cluster })
  } catch (error) {
    console.error('[POST /api/kafka/admin/clusters] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to register cluster' },
      { status: 500 }
    )
  }
}
