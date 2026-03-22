export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { status, error: deployError, url, lastDeployedAt } = body

    if (!status) {
      return NextResponse.json(
        { error: 'status required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const validStatuses = ['pending', 'deploying', 'generated', 'deployed', 'failed']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    const data: Record<string, unknown> = { status }
    if (deployError !== undefined) data.deploymentError = deployError || null
    if (url) data['target.url'] = url
    if (lastDeployedAt) data.lastDeployedAt = lastDeployedAt

    const updated = await payload.update({
      collection: 'deployments',
      id,
      data,
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      deployment: { id: updated.id, status: updated.status },
    })
  } catch (error) {
    console.error('[Internal API] Deployment status update error:', error)

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Deployment not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
