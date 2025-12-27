import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { listClusters, registerCluster } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/admin/clusters
 * List Kafka clusters (admin only)
 */
export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // TODO: Verify platform admin role

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
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // TODO: Verify platform admin role

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
