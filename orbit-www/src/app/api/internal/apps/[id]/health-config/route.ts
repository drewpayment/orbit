export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

// PATCH /api/internal/apps/{id}/health-config
//
// Updates app.healthConfig so the existing Apps afterChange hook picks up
// the change and starts/restarts the canonical HealthCheckWorkflow under
// the stable workflow id `health-check-{appId}` (TERMINATE_IF_RUNNING).
// Called by the Temporal worker's ConfigureAppHealthCheck activity, which
// is invoked by the Infra Agent's start_child_health_check tool. See
// GitHub issue #44 for the unification rationale.

interface HealthConfigBody {
  url?: string
  method?: 'GET' | 'HEAD' | 'POST'
  expectedStatus?: number
  interval?: number
  timeout?: number
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    )
  }

  try {
    const { id } = await params
    const body = (await request.json()) as HealthConfigBody

    if (typeof body !== 'object' || body == null) {
      return NextResponse.json(
        { error: 'Body must be an object', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const url = (body.url ?? '').trim()
    if (!url) {
      return NextResponse.json(
        { error: 'url is required', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const method = body.method ?? 'GET'
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      return NextResponse.json(
        { error: 'method must be one of GET, HEAD, POST', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const expectedStatus = body.expectedStatus ?? 200
    if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
      return NextResponse.json(
        { error: 'expectedStatus must be a valid HTTP status code', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    // Collection schema enforces interval >= 30; reject below that explicitly
    // so the caller gets a clear error instead of a generic validation failure.
    const interval = body.interval ?? 60
    if (!Number.isInteger(interval) || interval < 30) {
      return NextResponse.json(
        { error: 'interval must be an integer >= 30 (seconds)', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const timeout = body.timeout ?? 10
    if (!Number.isInteger(timeout) || timeout < 1) {
      return NextResponse.json(
        { error: 'timeout must be a positive integer (seconds)', code: 'BAD_REQUEST' },
        { status: 400 },
      )
    }

    const payload = await getPayload({ config: configPromise })

    const updatedApp = await payload.update({
      collection: 'apps',
      id,
      data: {
        healthConfig: { url, method, expectedStatus, interval, timeout },
      },
      overrideAccess: true,
    })

    return NextResponse.json({
      success: true,
      app: {
        id: updatedApp.id,
        healthConfig: updatedApp.healthConfig,
      },
    })
  } catch (error) {
    console.error('[Internal API] App health-config update error:', error)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'App not found', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
