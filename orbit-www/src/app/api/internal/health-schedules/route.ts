import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { HealthService } from '@/lib/proto/idp/health/v1/health_pb'

// Internal API for managing health check schedules
// Called by Payload collection hooks via fetch()

function getHealthServiceClient() {
  const transport = createGrpcTransport({
    baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
  })
  return createClient(HealthService, transport)
}

// POST - Create or update a health schedule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { appId, healthConfig } = body

    if (!appId) {
      return NextResponse.json({ error: 'appId is required' }, { status: 400 })
    }

    const client = getHealthServiceClient()

    if (healthConfig?.url) {
      // Create/update schedule
      const response = await client.manageSchedule({
        appId,
        healthConfig: {
          url: healthConfig.url,
          method: healthConfig.method || 'GET',
          expectedStatus: healthConfig.expectedStatus || 200,
          interval: healthConfig.interval || 60,
          timeout: healthConfig.timeout || 10,
        },
      })
      return NextResponse.json({ success: response.success, scheduleId: response.scheduleId })
    } else {
      // Delete schedule when no URL
      const response = await client.deleteSchedule({ appId })
      return NextResponse.json({ success: response.success })
    }
  } catch (error) {
    console.error('Failed to manage health schedule:', error)
    return NextResponse.json(
      { error: 'Failed to manage health schedule' },
      { status: 500 }
    )
  }
}

// DELETE - Remove a health schedule
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const appId = searchParams.get('appId')

    if (!appId) {
      return NextResponse.json({ error: 'appId is required' }, { status: 400 })
    }

    const client = getHealthServiceClient()
    const response = await client.deleteSchedule({ appId })

    return NextResponse.json({ success: response.success })
  } catch (error) {
    console.error('Failed to delete health schedule:', error)
    return NextResponse.json(
      { error: 'Failed to delete health schedule' },
      { status: 500 }
    )
  }
}
