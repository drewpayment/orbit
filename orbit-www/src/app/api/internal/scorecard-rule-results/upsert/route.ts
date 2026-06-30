export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { upsertRuleResult } from '@/lib/scorecards/evaluate'

/**
 * POST /api/internal/scorecard-rule-results/upsert
 *
 * Granular write-back for a single (scorecard, rule, entity) result — used by
 * workers that evaluate one rule/entity at a time rather than running the full
 * scorecard. Reuses the same idempotency key as runScorecardEvaluation, so a
 * full run and granular write-backs converge on the same row.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Body: { workspaceId, scorecardId, ruleId, entityId, passed, detail? }
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const body = await request.json()
    const { workspaceId, scorecardId, ruleId, entityId, passed } = body ?? {}

    const missing = (['workspaceId', 'scorecardId', 'ruleId', 'entityId'] as const).filter(
      (k) => typeof body?.[k] !== 'string' || !body[k],
    )
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `missing required string field(s): ${missing.join(', ')}` },
        { status: 400 },
      )
    }
    if (typeof passed !== 'boolean') {
      return NextResponse.json({ error: 'passed (boolean) is required' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })
    const id = await upsertRuleResult(payload, {
      workspaceId,
      scorecardId,
      ruleId,
      entityId,
      passed,
      detail: typeof body.detail === 'string' ? body.detail : '',
    })
    return NextResponse.json({ id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
