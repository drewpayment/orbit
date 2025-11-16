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

    const updates: any = { status }

    if (reason) {
      updates.suspensionReason = reason
      if (status === 'suspended') {
        updates.suspendedAt = new Date().toISOString()
      }
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
