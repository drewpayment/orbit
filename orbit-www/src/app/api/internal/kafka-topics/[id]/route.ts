import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * PATCH /api/internal/kafka-topics/[id]
 * Updates a Kafka topic's status and other fields.
 * Used by Temporal workflows to update topic provisioning status.
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
    const allowedFields = ['status', 'physicalName', 'provisioningError', 'workflowId', 'fullTopicName']
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
      const validStatuses = ['pending-approval', 'provisioning', 'active', 'failed', 'deleting', 'deleted']
      if (!validStatuses.includes(updateData.status as string)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
          { status: 400 }
        )
      }
    }

    const payload = await getPayload({ config: configPromise })

    // Update topic with overrideAccess to bypass collection access control
    const updatedTopic = await payload.update({
      collection: 'kafka-topics',
      id,
      data: updateData,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      topic: {
        id: updatedTopic.id,
        status: updatedTopic.status,
        physicalName: updatedTopic.fullTopicName,
      },
    })
  } catch (error) {
    console.error('[Internal API] Kafka topic update error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Topic not found', code: 'NOT_FOUND' },
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
 * DELETE /api/internal/kafka-topics/[id]
 * Deletes a Kafka topic record.
 * Used by Temporal workflows after successfully deleting a topic from Kafka.
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

    // Delete topic with overrideAccess to bypass collection access control
    await payload.delete({
      collection: 'kafka-topics',
      id,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('[Internal API] Kafka topic delete error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Topic not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
