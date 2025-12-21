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

    // Verify workspace exists
    try {
      await payload.findByID({
        collection: 'workspaces',
        id: workspaceId,
        overrideAccess: true,
      })
    } catch {
      return NextResponse.json(
        { error: 'Workspace not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Get all registry images for workspace, sorted by pushedAt ascending (oldest first)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const images = await (payload as any).find({
      collection: 'registry-images',
      where: { workspace: { equals: workspaceId } },
      sort: 'pushedAt',
      limit: 1000,
      depth: 1,
      overrideAccess: true,
    })

    // Map to include app name for cleanup algorithm
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = images.docs.map((img: any) => ({
      id: img.id,
      workspace: typeof img.workspace === 'string' ? img.workspace : img.workspace.id,
      app: typeof img.app === 'string' ? img.app : img.app.id,
      appName: typeof img.app === 'object' ? img.app.name : '',
      tag: img.tag,
      digest: img.digest,
      sizeBytes: img.sizeBytes,
      pushedAt: img.pushedAt,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Internal API] Registry images list error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
