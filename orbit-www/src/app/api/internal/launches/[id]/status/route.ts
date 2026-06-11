export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const { id } = await params
    const { status, error: launchError } = await request.json()

    if (!status) {
      return NextResponse.json(
        { error: 'status required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const validStatuses = [
      'pending', 'awaiting_approval', 'launching', 'active',
      'failed', 'deorbiting', 'deorbited', 'aborted',
    ]
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    const data: Record<string, unknown> = { status }
    if (launchError !== undefined) {
      data.launchError = launchError || null
    }

    const updated = await payload.update({
      collection: 'launches',
      id,
      data,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      launch: { id: updated.id, status: updated.status },
    })
  } catch (error) {
    console.error('[Internal API] Launch status update error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Launch not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
