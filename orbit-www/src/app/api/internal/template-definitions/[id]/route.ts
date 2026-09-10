export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * GET /api/internal/template-definitions/[id]
 *
 * Returns a template-definitions row's metadata (status, current published
 * version pointer) for the Go worker's `fetch:template` composition step
 * (Phase 4 Task D,
 * docs/plans/2026-09-10-template-authoring-phase-4-platform-steps.md §6) to
 * resolve `templateDefinitionId` -> the version to run when the step does
 * not pin an explicit `version`. Mirrors
 * template-definition-versions/[id]/route.ts's auth and id-flattening
 * conventions: relationship fields are flattened to plain string ids
 * regardless of Payload's populate depth, since the Go client only wants
 * the id.
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

  try {
    const payload = await getPayload({ config: configPromise })
    const doc = await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 0,
      overrideAccess: true,
    })

    const workspaceId = typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id
    const currentVersion =
      typeof doc.currentVersion === 'string' ? doc.currentVersion : doc.currentVersion?.id

    return NextResponse.json({
      definition: {
        id: doc.id,
        workspace: workspaceId,
        status: doc.status,
        currentVersion: currentVersion ?? '',
        name: doc.name,
      },
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'template definition not found' }, { status: 404 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
