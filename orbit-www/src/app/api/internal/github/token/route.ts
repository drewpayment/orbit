export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { decrypt } from '@/lib/encryption'

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
    const { installationId } = await request.json()

    if (!installationId) {
      return NextResponse.json(
        { error: 'installationId required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Find installation by GitHub installation ID (numeric)
    const installations = await payload.find({
      collection: 'github-installations',
      where: {
        installationId: { equals: Number(installationId) },
      },
      limit: 1,
      overrideAccess: true,
    })

    if (installations.docs.length === 0) {
      return NextResponse.json(
        { error: 'Installation not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const installation = installations.docs[0]

    // Check if token is expired
    const expiresAt = new Date(installation.tokenExpiresAt)
    if (expiresAt <= new Date()) {
      return NextResponse.json(
        { error: 'Token expired, refresh workflow may be stalled', code: 'EXPIRED' },
        { status: 410 }
      )
    }

    // Decrypt token
    const decryptedToken = decrypt(installation.installationToken)

    return NextResponse.json({
      token: decryptedToken,
      expiresAt: installation.tokenExpiresAt,
    })
  } catch (error) {
    console.error('[Internal API] Token fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
