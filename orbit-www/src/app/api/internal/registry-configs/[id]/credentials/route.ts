export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { decrypt } from '@/lib/encryption'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function GET(
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
    const payload = await getPayload({ config: configPromise })

    const config = await payload.findByID({
      collection: 'registry-configs',
      id,
      overrideAccess: true,
    })

    if (!config) {
      return NextResponse.json(
        { error: 'Registry config not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Build response based on registry type
    if (config.type === 'ghcr') {
      // Access fields that exist in schema but not in generated types yet
      const ghcrPat = (config as any).ghcrPat as string | undefined
      const ghcrOwner = (config as any).ghcrOwner as string | undefined

      if (!ghcrPat || !ghcrOwner) {
        return NextResponse.json(
          {
            error: 'GHCR credentials incomplete. Please configure a Personal Access Token.',
            code: 'INCOMPLETE_CREDENTIALS',
          },
          { status: 400 }
        )
      }

      return NextResponse.json({
        type: 'ghcr',
        url: 'ghcr.io',
        repository: ghcrOwner,
        token: decrypt(ghcrPat),
        username: 'x-access-token',
      })
    }

    if (config.type === 'acr') {
      if (!config.acrToken || !config.acrLoginServer || !config.acrUsername) {
        return NextResponse.json(
          {
            error: 'ACR credentials incomplete',
            code: 'INCOMPLETE_CREDENTIALS',
          },
          { status: 400 }
        )
      }

      return NextResponse.json({
        type: 'acr',
        url: config.acrLoginServer,
        repository: '', // Determined by app slug at build time
        token: decrypt(config.acrToken),
        username: config.acrUsername,
      })
    }

    if (config.type === 'orbit') {
      return NextResponse.json({
        type: 'orbit',
        url: process.env.ORBIT_REGISTRY_URL || 'localhost:5050',
        repository: '', // Determined by app slug at build time
        token: process.env.ORBIT_REGISTRY_TOKEN || '',
        username: 'orbit-service',
      })
    }

    return NextResponse.json(
      { error: 'Unknown registry type', code: 'UNKNOWN_TYPE' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[Internal API] Registry credentials fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
