export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * GET /api/internal/template-definitions/dry-run-sweep-candidates
 *
 * Feeds `TemplateDryRunSweepWorkflow`'s `ListPublishedTemplatesWithFixtures`
 * activity (Phase 4 Task G). Lists every PUBLISHED template-definition with a
 * resolved `currentVersion` — deliberately NOT filtered to definitions that
 * already have fixtures: a definition with zero fixtures must still come back
 * so the sweep workflow can log it as "no fixtures, not re-checked" rather
 * than silently never seeing it (the design's "broken paved paths must fail
 * loudly" principle extended to "silently never re-checked" being its own
 * failure mode, per the phase plan §7).
 *
 * Same X-API-Key auth model as every other `/api/internal/**` route.
 * Relationship fields are flattened to plain string ids regardless of
 * Payload's populate depth.
 */
export async function GET(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'template-definitions',
      depth: 0,
      overrideAccess: true,
      limit: 0,
      where: {
        and: [{ status: { equals: 'published' } }, { currentVersion: { exists: true } }],
      },
    })

    const templates = result.docs.map((doc) => {
      const workspaceId = typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id
      const currentVersionId =
        typeof doc.currentVersion === 'string' ? doc.currentVersion : doc.currentVersion?.id
      const fixtures = Array.isArray(doc.fixtures)
        ? doc.fixtures.map((f) => ({ id: f.id, name: f.name, values: f.values ?? {} }))
        : []

      return {
        id: doc.id,
        name: doc.name,
        workspaceId,
        currentVersionId,
        fixtures,
      }
    })

    return NextResponse.json({ templates })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
