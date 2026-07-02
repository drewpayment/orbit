export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { recomputeWorkspaceScores } from '@/lib/scorecards/evaluate'

/**
 * POST /api/internal/scorecards/recompute-scores
 *
 * Backfill/repair entry point for the entity-scores coverage invariant:
 * upserts an `overall` entity-scores row for EVERY catalog entity in the
 * workspace (base-value fallback when no scorecard applies), plus
 * `scorecard`-scope rows for every scorecard that has produced results for a
 * given entity. `runScorecardEvaluation` already calls this after every
 * scorecard run — this endpoint exists for cases with no scorecard to
 * trigger a run (a brand-new workspace, a manual repair) or that want the
 * whole workspace re-scored in one shot.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Body: { workspaceId: string }
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const body = await request.json()
    const workspaceId = body?.workspaceId
    if (typeof workspaceId !== 'string' || !workspaceId) {
      return NextResponse.json({ error: 'workspaceId (string) is required' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })
    const summary = await recomputeWorkspaceScores(payload, workspaceId)
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
