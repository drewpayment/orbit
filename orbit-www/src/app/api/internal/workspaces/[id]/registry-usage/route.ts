export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

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
    const { id: workspaceId } = await params
    const payload = await getPayload({ config: configPromise })

    // Get workspace for quota settings
    const workspace = await payload.findByID({
      collection: 'workspaces',
      id: workspaceId,
      overrideAccess: true,
    })

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Sum all image sizes for workspace
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = await (payload as any).find({
      collection: 'registry-images',
      where: { workspace: { equals: workspaceId } },
      limit: 1000,
      overrideAccess: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentBytes = images.docs.reduce((sum: number, img: any) => sum + (img.sizeBytes || 0), 0)
    // Default quota: 10GB (10737418240 bytes)
    const quotaBytes =
      (workspace.settings as Record<string, unknown> | undefined)?.registryQuotaBytes as
        | number
        | undefined || 10737418240

    return NextResponse.json({
      currentBytes,
      quotaBytes,
    })
  } catch (error) {
    console.error('[Internal API] Registry usage error:', error)

    // Check if it's a not found error
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'Workspace not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
