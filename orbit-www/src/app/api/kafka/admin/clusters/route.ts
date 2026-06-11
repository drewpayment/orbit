export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { listClusters, registerCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'
import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'

/**
 * GET /api/kafka/admin/clusters
 * List Kafka clusters (admin only)
 */
export async function GET() {
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!isPlatformAdmin(payloadUser)) {
    return NextResponse.json({ error: 'Forbidden: platform admin required' }, { status: 403 })
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
  const payloadUser = await getPayloadUserFromSession()
  if (!payloadUser) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!isPlatformAdmin(payloadUser)) {
    return NextResponse.json({ error: 'Forbidden: platform admin required' }, { status: 403 })
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
