export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * PATCH /api/internal/kafka-lineage-edges/[id]
 * Updates a Kafka lineage edge's fields.
 * Used by Temporal workflows to update edge metrics and status.
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
      'isActive',
      'lastSeen',
      'messagesAllTime',
      'bytesAllTime',
      'messagesLast24h',
      'bytesLast24h',
      'firstSeen',
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

    const payload = await getPayload({ config: configPromise })

    // Update edge with overrideAccess to bypass collection access control
    const updatedEdge = await payload.update({
      collection: 'kafka-lineage-edges',
      id,
      data: updateData,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      edge: {
        id: updatedEdge.id,
        isActive: updatedEdge.isActive,
        messagesAllTime: updatedEdge.messagesAllTime,
        bytesAllTime: updatedEdge.bytesAllTime,
      },
    })
  } catch (error) {
    console.error('[Internal API] Kafka lineage edge update error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Edge not found', code: 'NOT_FOUND' },
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
 * DELETE /api/internal/kafka-lineage-edges/[id]
 * Deletes a Kafka lineage edge record.
 * Used by Temporal workflows for cleanup operations.
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

    // Delete edge with overrideAccess to bypass collection access control
    await payload.delete({
      collection: 'kafka-lineage-edges',
      id,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('[Internal API] Kafka lineage edge delete error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Edge not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
