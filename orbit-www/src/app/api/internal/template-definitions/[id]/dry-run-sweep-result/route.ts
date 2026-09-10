export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * POST /api/internal/template-definitions/[id]/dry-run-sweep-result
 *
 * Write-back endpoint for `ScaffolderWorkflow.finish()`'s
 * `RecordSweepResult` activity (Phase 4 Task G) — the ONLY caller, and only
 * for a run with `DryRun: true` and `Trigger: "scheduled-sweep"`; a human
 * "Preview" dry run never reaches this route (see `ScaffolderWorkflow`'s
 * `finish()`), so `lastDryRunStatus`/`lastDryRunPlanHash` can never be
 * clobbered by a manual click.
 *
 * The Go side computes a stable content hash of the run's `PlannedChange[]`
 * and reports it here along with whether the run failed; this route decides
 * `ok`/`drifted`/`failed` by comparing against the definition's CURRENTLY
 * stored `lastDryRunPlanHash` — keeping that comparison in one place (this
 * route) rather than round-tripping the stored hash back to the worker
 * first. A failed run's hash is not trustworthy (the run may have failed
 * before producing a real plan), so on failure the previously stored hash is
 * preserved rather than overwritten — the NEXT successful sweep still has a
 * real baseline to compare against.
 *
 * Body: `{ failed: boolean, planHash: string }`. `planHash` may be an empty
 * string (an empty plan hashes to a fixed value upstream); this route treats
 * "no prior hash recorded yet" (`lastDryRunPlanHash` unset) as `ok`, not
 * `drifted` — there is nothing to have drifted from.
 *
 * Same X-API-Key auth model as every other `/api/internal/**` route.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.failed !== 'boolean') {
    return NextResponse.json({ error: 'failed must be a boolean' }, { status: 400 })
  }
  if (typeof body.planHash !== 'string') {
    return NextResponse.json({ error: 'planHash must be a string' }, { status: 400 })
  }
  const failed = body.failed
  const planHash = body.planHash

  const payload = await getPayload({ config: configPromise })

  let definition: { lastDryRunPlanHash?: string | null }
  try {
    definition = await payload.findByID({
      collection: 'template-definitions',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return NextResponse.json({ error: 'template definition not found' }, { status: 404 })
  }

  let status: 'ok' | 'drifted' | 'failed'
  let nextHash: string
  if (failed) {
    status = 'failed'
    nextHash = definition.lastDryRunPlanHash ?? ''
  } else {
    const previousHash = definition.lastDryRunPlanHash
    status = !previousHash || previousHash === planHash ? 'ok' : 'drifted'
    nextHash = planHash
  }

  await payload.update({
    collection: 'template-definitions',
    id,
    data: {
      lastDryRunAt: new Date().toISOString(),
      lastDryRunStatus: status,
      lastDryRunPlanHash: nextHash,
    },
    overrideAccess: true,
  })

  return NextResponse.json({ status })
}
