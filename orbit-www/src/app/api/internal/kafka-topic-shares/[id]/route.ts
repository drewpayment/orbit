import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * GET /api/internal/kafka-topic-shares/[id]
 * Retrieves a Kafka topic share by ID with related data.
 * Used by Temporal workflows to fetch share and topic configuration.
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

    // Fetch share with depth to include related topic, workspaces, etc.
    const share = await payload.findByID({
      collection: 'kafka-topic-shares',
      id,
      depth: 2,
      overrideAccess: true,
    })

    if (!share) {
      return NextResponse.json(
        { error: 'Share not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(share)
  } catch (error) {
    console.error('[Internal API] Kafka topic share get error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Share not found', code: 'NOT_FOUND' },
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
 * PATCH /api/internal/kafka-topic-shares/[id]
 * Updates a Kafka topic share's status and other fields.
 * Used by Temporal workflows to update share provisioning status.
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
    const allowedFields = ['status', 'error', 'approvedAt', 'approvedBy', 'rejectionReason', 'workflowId']
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

    // Validate status if provided
    if (updateData.status) {
      const validStatuses = ['pending', 'approved', 'rejected', 'revoked', 'expired']
      if (!validStatuses.includes(updateData.status as string)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
          { status: 400 }
        )
      }
    }

    const payload = await getPayload({ config: configPromise })

    // Update share with overrideAccess to bypass collection access control
    const updatedShare = await payload.update({
      collection: 'kafka-topic-shares',
      id,
      data: updateData,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      share: {
        id: updatedShare.id,
        status: updatedShare.status,
      },
    })
  } catch (error) {
    console.error('[Internal API] Kafka topic share update error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Share not found', code: 'NOT_FOUND' },
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
 * DELETE /api/internal/kafka-topic-shares/[id]
 * Deletes a Kafka topic share record.
 * Used by Temporal workflows after revoking access.
 */
export async function DELETE(
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

    // Delete share with overrideAccess to bypass collection access control
    await payload.delete({
      collection: 'kafka-topic-shares',
      id,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('[Internal API] Kafka topic share delete error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Share not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
