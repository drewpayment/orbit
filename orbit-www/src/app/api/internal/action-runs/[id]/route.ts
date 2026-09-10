export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * GET /api/internal/action-runs/[id]
 *
 * Lets the Go repository service prove a run belongs to the caller's
 * workspace and seed user/workspace context BEFORE starting a
 * ScaffolderWorkflow — a small membership/identity check, not the run's
 * write-back endpoint (that's `[id]/status`, kept separate). Same X-API-Key
 * auth model as every other `/api/internal/**` route.
 *
 * Deliberately narrow: never returns `inputs`/`outputs`/`logs` (may hold
 * `ui:secret` parameter values or other run-sensitive data) — only the
 * identity/workspace fields the worker actually needs. `workspace` and
 * `triggeredBy` are flattened to `{ id, slug|email, name }` objects
 * regardless of Payload's populate depth (a bare id string still yields an
 * `{ id, ...: null }` shape the Go client can destructure safely);
 * `templateVersion` is flattened to a plain string id (or `null`).
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
      collection: 'action-runs',
      id,
      depth: 1,
      overrideAccess: true,
    })

    const workspace =
      typeof doc.workspace === 'string'
        ? { id: doc.workspace, slug: null, name: null }
        : { id: doc.workspace.id, slug: doc.workspace.slug ?? null, name: doc.workspace.name ?? null }

    const templateVersionId =
      !doc.templateVersion
        ? null
        : typeof doc.templateVersion === 'string'
          ? doc.templateVersion
          : doc.templateVersion.id

    const triggeredBy = !doc.triggeredBy
      ? null
      : typeof doc.triggeredBy === 'string'
        ? { id: doc.triggeredBy, email: null, name: null }
        : { id: doc.triggeredBy.id, email: doc.triggeredBy.email ?? null, name: doc.triggeredBy.name ?? null }

    return NextResponse.json({
      run: {
        id: doc.id,
        workspace,
        templateVersion: templateVersionId,
        dryRun: doc.dryRun ?? false,
        status: doc.status,
        triggeredBy,
      },
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'action run not found' }, { status: 404 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
