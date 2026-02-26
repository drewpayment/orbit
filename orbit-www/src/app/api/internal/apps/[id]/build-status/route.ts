export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

interface BuildStatusUpdate {
  status: string
  imageUrl?: string
  imageDigest?: string
  error?: string
  availableChoices?: string[]
  buildConfig?: {
    language?: string
    languageVersion?: string
    framework?: string
    buildCommand?: string
    startCommand?: string
  }
}

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
    const body: BuildStatusUpdate = await request.json()

    if (!body.status) {
      return NextResponse.json(
        { error: 'status required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const validStatuses = ['none', 'analyzing', 'awaiting_input', 'building', 'success', 'failed']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Get current app to preserve existing latestBuild data
    const currentApp = await payload.findByID({
      collection: 'apps',
      id,
      depth: 0,
    })

    if (!currentApp) {
      return NextResponse.json(
        { error: 'App not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Build the latestBuild update object
    const latestBuildUpdate: Record<string, unknown> = {
      status: body.status,
    }

    // Update fields based on status
    if (body.status === 'success') {
      latestBuildUpdate.imageUrl = body.imageUrl || null
      latestBuildUpdate.imageDigest = body.imageDigest || null
      latestBuildUpdate.builtAt = new Date().toISOString()
      latestBuildUpdate.error = null
    } else if (body.status === 'failed') {
      latestBuildUpdate.error = body.error || 'Unknown error'
    } else if (body.status === 'awaiting_input') {
      if (body.availableChoices) {
        latestBuildUpdate.availableChoices = body.availableChoices
      }
    }

    // Update build config if provided
    const buildConfigUpdate: Record<string, unknown> = {}
    if (body.buildConfig) {
      if (body.buildConfig.language) {
        buildConfigUpdate.language = body.buildConfig.language
      }
      if (body.buildConfig.languageVersion) {
        buildConfigUpdate.languageVersion = body.buildConfig.languageVersion
      }
      if (body.buildConfig.framework) {
        buildConfigUpdate.framework = body.buildConfig.framework
      }
      if (body.buildConfig.buildCommand) {
        buildConfigUpdate.buildCommand = body.buildConfig.buildCommand
      }
      if (body.buildConfig.startCommand) {
        buildConfigUpdate.startCommand = body.buildConfig.startCommand
      }
    }

    // Update app with latestBuild and optionally buildConfig
    const updateData: Record<string, unknown> = {
      latestBuild: {
        ...currentApp.latestBuild,
        ...latestBuildUpdate,
      },
    }

    if (Object.keys(buildConfigUpdate).length > 0) {
      updateData.buildConfig = {
        ...currentApp.buildConfig,
        ...buildConfigUpdate,
      }
    }

    const updatedApp = await payload.update({
      collection: 'apps',
      id,
      data: updateData,
      overrideAccess: true,
    })

    console.log(`[Internal API] Build status updated for app ${id}: ${body.status}`)

    return NextResponse.json({
      success: true,
      app: {
        id: updatedApp.id,
        latestBuild: updatedApp.latestBuild,
        buildConfig: updatedApp.buildConfig,
      },
    })
  } catch (error) {
    console.error('[Internal API] Build status update error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'App not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
