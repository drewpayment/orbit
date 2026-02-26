export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { createInstallationToken } from '@/lib/github/octokit'
import { encrypt } from '@/lib/encryption'

export async function POST(request: NextRequest) {
  try {
    const { installationId } = await request.json()

    if (!installationId) {
      return NextResponse.json({ error: 'installationId required' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })

    // Get installation from Payload
    const installation = await payload.findByID({
      collection: 'github-installations',
      id: installationId,
    })

    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    // Create new token from GitHub
    const { token, expiresAt } = await createInstallationToken(installation.installationId)

    // Encrypt token
    const encryptedToken = encrypt(token)

    // Update installation in Payload
    await payload.update({
      collection: 'github-installations',
      id: installationId,
      data: {
        installationToken: encryptedToken,
        tokenExpiresAt: expiresAt.toISOString(),
        tokenLastRefreshedAt: new Date().toISOString(),
        status: 'active',
        temporalWorkflowStatus: 'running',
      },
    })

    return NextResponse.json({
      Success: true,
      ExpiresAt: expiresAt.toISOString(),
      ErrorMessage: '',
    })
  } catch (error) {
    console.error('[Temporal Activity] Refresh token error:', error)
    return NextResponse.json(
      {
        Success: false,
        ExpiresAt: new Date().toISOString(),
        ErrorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
