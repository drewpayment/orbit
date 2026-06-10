export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

export async function POST(request: NextRequest) {
  try {
    const { installationId, status, reason } = await request.json()

    if (!installationId || !status) {
      return NextResponse.json({ error: 'installationId and status required' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })

    const updates: Record<string, unknown> = { status }

    if (status === 'active') {
      // Successful refresh clears the failure streak.
      updates.consecutiveFailureCount = 0
    } else if (status === 'refresh_failed' || status === 'needs_reconnect') {
      // Track failure telemetry so the UI/operators can see escalation pressure.
      const existing = await payload.findByID({
        collection: 'github-installations',
        id: installationId,
      })
      const current = (existing?.consecutiveFailureCount as number | undefined) ?? 0
      updates.consecutiveFailureCount = current + 1
      updates.lastFailureReason = reason || 'Unknown error'
      updates.lastFailureAt = new Date().toISOString()
    } else if (status === 'suspended') {
      if (reason) {
        updates.suspensionReason = reason
      }
      updates.suspendedAt = new Date().toISOString()
    }

    await payload.update({
      collection: 'github-installations',
      id: installationId,
      data: updates,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Temporal Activity] Update status error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
