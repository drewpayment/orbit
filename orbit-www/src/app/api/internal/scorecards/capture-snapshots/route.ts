export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { captureScoreSnapshots } from '@/lib/scorecards/snapshots'

/**
 * POST /api/internal/scorecards/capture-snapshots
 *
 * Manual/backfill entry point for score-history snapshots (Scorecard Reports
 * & Insights, docs/plans/2026-07-01-scorecard-reports.md WP1). Appends a
 * `score-snapshots` row per scope (workspace/scorecard/team) from the
 * workspace's LIVE entity-scores + scorecard-rule-results rows —
 * `runScorecardEvaluation` and `recomputeWorkspaceScores` already call this
 * fire-and-forget after every evaluation/recompute; this endpoint exists for
 * cases that want a snapshot without running a full evaluation, or that need
 * to bypass the 30-minute throttle (`force: true`).
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Body: { workspaceId: string, force?: boolean }
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
    const force = body?.force === true

    const payload = await getPayload({ config: configPromise })
    const result = await captureScoreSnapshots(payload, workspaceId, { force })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
