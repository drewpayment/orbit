export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { slugify, uniqueSlug } from '@/lib/catalog/entity-crud'

/**
 * POST /api/internal/templates/[id]/finalize
 *
 * Called by the temporal worker's FinalizeInstantiation activity once a
 * template has been cloned, rendered, and pushed to a new repository.
 * Increments the template's usageCount and creates a CatalogEntities row
 * (`source.type: 'template'`, `source.sourceId: <templateId>`) so the new
 * repo is tracked back to the template it came from.
 *
 * NOT idempotent: a Temporal activity retry (MaximumAttempts: 3) that loses
 * its response will double-increment usageCount and create a second catalog
 * entity. Pre-existing class of risk for this workflow (Phase 0 plan, Risk 4);
 * follow-up is to thread the workflow run id through as an idempotency key.
 *
 * Body:
 *   {
 *     workspaceId: string,
 *     repoUrl: string,
 *     repoName: string,
 *     userId?: string,
 *   }
 *
 * Auth: X-API-Key.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const required = ['workspaceId', 'repoUrl', 'repoName']
  for (const field of required) {
    if (typeof body[field] !== 'string' || (body[field] as string).trim() === '') {
      return NextResponse.json({ error: `${field} required` }, { status: 400 })
    }
  }

  const workspaceId = body.workspaceId as string
  const repoUrl = body.repoUrl as string
  const repoName = body.repoName as string

  try {
    const payload = await getPayload({ config: configPromise })

    let template
    try {
      template = await payload.findByID({
        collection: 'templates',
        id,
        overrideAccess: true,
      })
    } catch (err) {
      // Mirrors patterns/[id]/route.ts: only translate Payload's "not found"
      // into a 404; any other failure (e.g. a DB outage) stays a 500 below.
      if (err instanceof Error && err.message.toLowerCase().includes('not found')) {
        return NextResponse.json({ error: 'template not found' }, { status: 404 })
      }
      throw err
    }
    if (!template) {
      return NextResponse.json({ error: 'template not found' }, { status: 404 })
    }

    // Decision 8 (Phase 0 plan): read-then-write, not atomic — no `$inc`
    // precedent in this codebase. See the not-idempotent note above.
    const usageCount = (template.usageCount ?? 0) + 1
    await payload.update({
      collection: 'templates',
      id,
      data: { usageCount },
      overrideAccess: true,
    })

    const slugBase = slugify(repoName) || 'template'
    const existing = await payload.find({
      collection: 'catalog-entities',
      where: {
        and: [{ workspace: { equals: workspaceId } }, { slug: { contains: slugBase } }],
      },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    const taken = existing.docs
      .map((d) => d.slug)
      .filter((s): s is string => Boolean(s))
    const slug = uniqueSlug(slugBase, taken)

    const entity = await payload.create({
      collection: 'catalog-entities',
      data: {
        name: repoName,
        slug,
        kind: 'service',
        workspace: workspaceId,
        source: { type: 'template', sourceId: id },
        links: [{ label: 'Repository', url: repoUrl, type: 'repository' }],
      },
      overrideAccess: true,
    })

    return NextResponse.json({ catalogEntityId: String(entity.id), usageCount })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
