export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { runScorecardEvaluation } from '@/lib/scorecards/evaluate'

/**
 * POST /api/internal/scorecards/evaluate
 *
 * Runs a full scorecard evaluation: loads the scorecard's rules and the
 * entities it appliesTo, evaluates every rule against every entity, and
 * idempotently upserts scorecard-rule-results. The future Temporal/Go entry
 * point for scheduled / event-driven re-scoring.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Body: { scorecardId: string }
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const body = await request.json()
    const scorecardId = body?.scorecardId
    if (typeof scorecardId !== 'string' || !scorecardId) {
      return NextResponse.json({ error: 'scorecardId (string) is required' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })
    const summary = await runScorecardEvaluation(payload, scorecardId, {
      captureSnapshots: body?.captureSnapshots !== false,
    })
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
