export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * GET /api/internal/kafka-applications/[id]
 * Retrieves a Kafka application by ID.
 * Used by Temporal workflows to fetch application details.
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

    const application = await payload.findByID({
      collection: 'kafka-applications',
      id,
      depth: 1,
      overrideAccess: true,
    })

    if (!application) {
      return NextResponse.json(
        { error: 'Application not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(application)
  } catch (error) {
    console.error('[Internal API] Kafka application get error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Application not found', code: 'NOT_FOUND' },
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
 * PATCH /api/internal/kafka-applications/[id]
 * Updates a Kafka application's provisioning status.
 * Used by Temporal workflows to update provisioning status on success/failure.
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

    // Validate we have at least one field to update
    const allowedFields = [
      'provisioningStatus',
      'provisioningError',
      'provisioningDetails',
      'provisioningWorkflowId',
      'provisioningCompletedAt',
      'status',
    ]
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

    // Validate provisioningStatus if provided
    if (updateData.provisioningStatus) {
      const validStatuses = ['pending', 'in_progress', 'completed', 'partial', 'failed']
      if (!validStatuses.includes(updateData.provisioningStatus as string)) {
        return NextResponse.json(
          {
            error: `Invalid provisioningStatus. Must be one of: ${validStatuses.join(', ')}`,
            code: 'BAD_REQUEST',
          },
          { status: 400 }
        )
      }
    }

    const payload = await getPayload({ config: configPromise })

    const updatedApp = await payload.update({
      collection: 'kafka-applications',
      id,
      data: updateData,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      application: {
        id: updatedApp.id,
        provisioningStatus: updatedApp.provisioningStatus,
      },
    })
  } catch (error) {
    console.error('[Internal API] Kafka application update error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Application not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
