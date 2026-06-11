export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * GET /api/internal/patterns/[id]
 *
 * Returns a single pattern's full content (templateJson + inputSchemaJson).
 * Used by the temporal worker's GetPatternByID activity at the start of
 * the agent's instantiate_pattern dispatch so the workflow can validate
 * parameters and render the template. The list route omits these fields
 * to keep the LLM-visible catalog bounded; this route exposes them for
 * server-side execution.
 *
 * Auth: X-API-Key.
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
      collection: 'patterns',
      id,
      overrideAccess: true,
    })
    return NextResponse.json({
      pattern: {
        id: doc.id,
        name: doc.name,
        displayName: doc.displayName,
        description: doc.description,
        category: doc.category,
        templateKind: doc.templateKind,
        templateJson: doc.templateJson,
        inputSchemaJson: doc.inputSchemaJson,
        status: doc.status,
        currentVersion: doc.currentVersion ?? 1,
      },
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'pattern not found' }, { status: 404 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
