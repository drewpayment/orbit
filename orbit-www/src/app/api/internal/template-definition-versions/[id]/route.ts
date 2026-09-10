export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * GET /api/internal/template-definition-versions/[id]
 *
 * Returns a single template-definition-version's full content
 * (definitionJson) for the Go repository service / ScaffolderWorkflow to
 * resolve `definitionVersionId` -> the v2 document before dispatch (phase-1
 * plan §6.1). `template-definition-versions` is write-closed to humans and
 * read via `workspaceScopedRead()` for the app, but the Go worker has no
 * workspace-scoped session — this internal route bypasses that with
 * `overrideAccess: true`, same X-API-Key auth model as every other
 * `/api/internal/**` route.
 *
 * Relationship fields (`definition`, `workspace`) are flattened to plain
 * string ids regardless of Payload's populate depth, since the Go client
 * only wants the id.
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
      collection: 'template-definition-versions',
      id,
      depth: 0,
      overrideAccess: true,
    })

    const definitionId = typeof doc.definition === 'string' ? doc.definition : doc.definition?.id
    const workspaceId = typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id

    return NextResponse.json({
      version: {
        id: doc.id,
        definition: definitionId,
        workspace: workspaceId,
        versionNumber: doc.versionNumber,
        definitionJson: doc.definitionJson,
      },
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'template definition version not found' }, { status: 404 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
