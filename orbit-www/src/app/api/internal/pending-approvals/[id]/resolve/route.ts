export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * Spike 7 commit γ — POST /api/internal/pending-approvals/[id]/resolve
 *
 * Body shape:
 *   {
 *     status: 'resolved' | 'aborted',     // 'aborted' = workflow was killed
 *     resolution?: 'approved' | 'rejected',
 *     resolvedBy?: string,
 *     notes?: string,
 *     reviewerRounds?: number,
 *   }
 *
 * Idempotent: re-posting on an already-resolved row updates the timestamp
 * but preserves the original resolver. The workflow-side activity treats
 * any 2xx as success.
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
    const status = body.status === 'aborted' ? 'aborted' : 'resolved'
    const data: Record<string, unknown> = { status }

    if (status === 'resolved') {
      if (body.resolution === 'approved' || body.resolution === 'rejected') {
        data.resolution = body.resolution
      }
      data.resolvedAt = new Date().toISOString()
      if (body.resolvedBy) data.resolvedBy = body.resolvedBy
      if (typeof body.notes === 'string') data.notes = body.notes
      if (typeof body.reviewerRounds === 'number') data.reviewerRounds = body.reviewerRounds
    }

    const payload = await getPayload({ config: configPromise })
    const updated = await payload.update({
      collection: 'pending-approvals',
      id,
      data,
      overrideAccess: true,
    })
    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
