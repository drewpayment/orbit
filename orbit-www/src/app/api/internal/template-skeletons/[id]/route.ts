export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * GET /api/internal/template-skeletons/[id]?workspaceId=<id>[&manifest=1]
 *
 * Contract consumed by the Go `fetch:orbit-skeleton` scaffolder action
 * (`temporal-workflows/internal/scaffolder/actions/fetch_orbit_skeleton.go`
 * + `internal/services/payload_skeleton_client.go`), per
 * docs/plans/2026-09-10-template-authoring-phase-3-greenfield-content.md
 * §3.2 and lead decision §7.5.
 *
 * Auth: `X-API-Key` (see `validateInternalApiKey`), checked BEFORE any
 * database access — same convention as every other `/api/internal/**`
 * route.
 *
 * Tenant isolation: `workspaceId` is REQUIRED as a query param. When it is
 * missing, or does not match the skeleton's own `workspace`, the route
 * returns 404 (never 403) so the internal API key alone can never be used
 * to probe for or read another workspace's bundle. The Go action always
 * passes `rc.WorkspaceID` for this parameter.
 *
 * Response shapes:
 *   - Default (no `?manifest`):
 *       {
 *         id: string, name: string, slug: string,
 *         version: number, totalSize: number,
 *         files: [{ path: string, size: number, content: string }]
 *       }
 *   - `?manifest=1` (lighter, no file content — used by the action's
 *     `Plan`/dry-run path, which only needs to know what would be written):
 *       {
 *         id: string, name: string, slug: string,
 *         version: number, totalSize: number,
 *         files: [{ path: string, size: number }]
 *       }
 *
 * Errors: 400 (missing workspaceId or id), 401 (bad/missing API key),
 * 404 (skeleton not found, or found but workspaceId does not match),
 * 500 (anything else).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const workspaceId = request.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId query param required' }, { status: 400 })
  }
  const manifestOnly = request.nextUrl.searchParams.get('manifest') === '1'

  try {
    const payload = await getPayload({ config: configPromise })
    const doc = await payload.findByID({
      collection: 'template-skeletons',
      id,
      depth: 0,
      overrideAccess: true,
    })

    const docWorkspaceId = typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id
    if (!docWorkspaceId || docWorkspaceId !== workspaceId) {
      // Deliberately 404, not 403 (§7.5): the API key alone must never be
      // sufficient to confirm another workspace's skeleton even exists.
      return NextResponse.json({ error: 'template skeleton not found' }, { status: 404 })
    }

    const rawFiles = Array.isArray(doc.files) ? doc.files : []
    const files = manifestOnly
      ? rawFiles.map((f) => ({ path: f.path, size: f.size }))
      : rawFiles.map((f) => ({ path: f.path, size: f.size, content: f.content }))

    return NextResponse.json({
      id: doc.id,
      name: doc.name,
      slug: doc.slug,
      version: doc.version,
      totalSize: doc.totalSize,
      files,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'template skeleton not found' }, { status: 404 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
