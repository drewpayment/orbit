export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * GET /api/internal/workspaces/[id]/apps
 *
 * Returns sanitized summaries of every app in the workspace. Used by the
 * Infrastructure Agent (orbit_list_apps tool) to discover what's deployable.
 * Auth via shared internal API key only — never exposed to the browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'workspace id required' }, { status: 400 })

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'apps',
      where: { workspace: { equals: id } },
      limit: 200,
      depth: 0,
      overrideAccess: true,
    })

    const apps = result.docs.map((app) => {
      const repo = (app as { repository?: { url?: string; owner?: string; name?: string; branch?: string } }).repository
      return {
        id: app.id,
        name: app.name,
        description: (app as { description?: string }).description ?? '',
        status: (app as { status?: string }).status ?? 'unknown',
        repository: repo
          ? { url: repo.url ?? '', owner: repo.owner ?? '', name: repo.name ?? '', branch: repo.branch ?? '' }
          : null,
      }
    })

    return NextResponse.json({ apps })
  } catch (err) {
    console.error('[internal/workspaces/apps] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
