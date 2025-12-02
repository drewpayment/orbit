import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const { app, status, statusCode, responseTime, error: errorMsg, checkedAt } = body

    if (!app) {
      return NextResponse.json(
        { error: 'app (appId) required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    if (!status) {
      return NextResponse.json(
        { error: 'status required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const validStatuses = ['healthy', 'degraded', 'down']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Verify app exists
    try {
      await payload.findByID({
        collection: 'apps',
        id: app,
        overrideAccess: true,
      })
    } catch {
      return NextResponse.json(
        { error: 'App not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Create health check record
    const healthCheck = await payload.create({
      collection: 'health-checks',
      data: {
        app,
        status,
        statusCode: statusCode || null,
        responseTime: responseTime || null,
        error: errorMsg || null,
        checkedAt: checkedAt || new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        app: healthCheck.app,
        status: healthCheck.status,
        checkedAt: healthCheck.checkedAt,
      },
    })
  } catch (error) {
    console.error('[Internal API] Health check creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
