import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * GET /api/internal/kafka-virtual-clusters/[id]
 * Retrieves a Kafka virtual cluster by ID with related data.
 * Used by Temporal workflows to fetch virtual cluster and physical cluster configuration.
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

    // Fetch virtual cluster with depth to include related physicalCluster
    const virtualCluster = await payload.findByID({
      collection: 'kafka-virtual-clusters',
      id,
      depth: 2, // Include physicalCluster with its connectionConfig
      overrideAccess: true,
    })

    if (!virtualCluster) {
      return NextResponse.json(
        { error: 'Virtual cluster not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(virtualCluster)
  } catch (error) {
    console.error('[Internal API] Kafka virtual cluster get error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Virtual cluster not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/internal/kafka-virtual-clusters/[id]
 * Updates a Kafka virtual cluster's status and other fields.
 * Used by Temporal workflows to update virtual cluster provisioning status.
 */
export async function PATCH(
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
    const body = await request.json()

    const allowedFields = ['status', 'provisioningError']
    const updateData: Record<string, unknown> = {}

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    const updatedVC = await payload.update({
      collection: 'kafka-virtual-clusters',
      id,
      data: updateData,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      virtualCluster: {
        id: updatedVC.id,
        status: updatedVC.status,
      },
    })
  } catch (error) {
    console.error('[Internal API] Kafka virtual cluster update error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Virtual cluster not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
