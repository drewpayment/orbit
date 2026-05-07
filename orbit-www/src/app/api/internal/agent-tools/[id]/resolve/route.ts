export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * POST /api/internal/agent-tools/[id]/resolve
 * { approved: boolean, resolvedBy: string, reason?: string }
 *
 * Flips a pending row to approved or rejected. Called by the temporal
 * worker after the human approval signal arrives. The audit fields
 * (approvedBy, approvedAt, rejectionReason) are written here so the
 * collection retains the full HITL trail.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const approved = Boolean(body.approved)
    const payload = await getPayload({ config: configPromise })

    const data: Record<string, unknown> = {
      status: approved ? 'approved' : 'rejected',
    }
    if (approved) {
      data.approvedBy = body.resolvedBy ?? null
      data.approvedAt = new Date().toISOString()
    } else {
      data.rejectionReason = body.reason ?? ''
    }

    const updated = await payload.update({
      collection: 'agent-tools',
      id,
      data,
      overrideAccess: true,
    })
    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
