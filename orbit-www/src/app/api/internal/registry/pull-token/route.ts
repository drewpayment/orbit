export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { generatePullToken } from '@/lib/registry-auth'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY
const REGISTRY_URL = process.env.ORBIT_REGISTRY_URL || 'localhost:5050'

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
    const { appId } = body

    if (!appId) {
      return NextResponse.json(
        { error: 'appId is required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Fetch app with workspace populated
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 1,
      overrideAccess: true,
    })

    if (!app) {
      return NextResponse.json(
        { error: 'App not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Get workspace slug
    const workspace = typeof app.workspace === 'string'
      ? null
      : app.workspace

    if (!workspace?.slug) {
      return NextResponse.json(
        { error: 'App workspace not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Generate pull token
    const expiresInSeconds = 3600 // 1 hour
    const token = await generatePullToken({
      workspaceSlug: workspace.slug,
      appSlug: app.name,
    })

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

    return NextResponse.json({
      username: 'orbit-pull',
      password: token,
      registry: REGISTRY_URL,
      expiresAt,
    })
  } catch (error) {
    console.error('[Internal API] Pull token generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
