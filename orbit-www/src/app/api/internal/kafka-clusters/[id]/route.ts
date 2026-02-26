export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * GET /api/internal/kafka-clusters/[id]
 * Retrieves a Kafka cluster by ID with connection configuration.
 * Used by Temporal workflows to fetch cluster connection details for topic provisioning.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const { id } = await params

    const payload = await getPayload({ config: configPromise })

    // Fetch cluster with connection config
    const cluster = await payload.findByID({
      collection: 'kafka-clusters',
      id,
      depth: 1,
      overrideAccess: true,
    })

    if (!cluster) {
      return NextResponse.json(
        { error: 'Cluster not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(cluster)
  } catch (error) {
    console.error('[Internal API] Kafka cluster get error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Cluster not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
