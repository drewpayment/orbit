export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * GET /api/internal/workspaces/[id]/apps/[appId]
 *
 * Returns full details of a single app, scoped to the workspace. Used by
 * the Infrastructure Agent (orbit_get_app tool) when it needs more than the
 * summary list returns. Sensitive fields (encrypted env-var values, etc.)
 * are deliberately omitted.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; appId: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id, appId } = await params
  if (!id || !appId) {
    return NextResponse.json({ error: 'workspace id and app id required' }, { status: 400 })
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const app = await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 0,
      overrideAccess: true,
    })

    const appWorkspace = (app as { workspace?: string | { id: string } }).workspace
    const appWorkspaceId = typeof appWorkspace === 'string' ? appWorkspace : appWorkspace?.id
    if (appWorkspaceId !== id) {
      return NextResponse.json({ error: 'App not found in this workspace' }, { status: 404 })
    }

    const repo = (app as {
      repository?: {
        url?: string
        owner?: string
        name?: string
        branch?: string
        provider?: string
        // depth:0 read → a git-connections id string (object shape handled defensively).
        connection?: string | { id?: string }
        project?: string
      }
    }).repository
    const healthConfig = (app as { healthConfig?: Record<string, unknown> }).healthConfig
    const buildConfig = (app as { buildConfig?: Record<string, unknown> }).buildConfig

    const connectionId = typeof repo?.connection === 'string'
      ? repo.connection
      : repo?.connection?.id ?? ''

    return NextResponse.json({
      id: app.id,
      name: app.name,
      description: (app as { description?: string }).description ?? '',
      status: (app as { status?: string }).status ?? 'unknown',
      repository: repo
        ? {
            url: repo.url ?? '',
            owner: repo.owner ?? '',
            name: repo.name ?? '',
            branch: repo.branch ?? '',
            // WI1 provider fields for the ADO-aware Go clone path. Empty for
            // legacy/GitHub apps; the Go side branches on provider.
            provider: repo.provider ?? '',
            connectionId,
            project: repo.project ?? '',
          }
        : null,
      healthConfig: healthConfig ?? null,
      buildConfig: buildConfig ?? null,
    })
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 })
    }
    console.error('[internal/workspaces/apps/[appId]] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
