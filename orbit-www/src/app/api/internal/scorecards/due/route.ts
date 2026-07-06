export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

const PAGE_SIZE = 100

/**
 * GET /api/internal/scorecards/due
 *
 * Lists every enabled scorecard across every workspace. This is the machine
 * sweep surface the Temporal `ScorecardEvaluationSweepWorkflow` polls
 * nightly to decide what to POST to `/api/internal/scorecards/evaluate` —
 * there is no tenant filter, same trust level as `evaluate`.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Response: { scorecards: [{ id, workspaceId }] }
 */
export async function GET(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const payload = await getPayload({ config: configPromise })
    const scorecards: { id: string; workspaceId: string }[] = []

    for (let page = 1; ; page++) {
      const res = await payload.find({
        collection: 'scorecards',
        where: { enabled: { equals: true } },
        limit: PAGE_SIZE,
        page,
        depth: 0,
        overrideAccess: true,
      })

      for (const doc of res.docs as { id: string; workspace?: unknown }[]) {
        const workspaceId =
          typeof doc.workspace === 'string'
            ? doc.workspace
            : (doc.workspace as { id?: string } | null | undefined)?.id

        if (!workspaceId) continue
        scorecards.push({ id: doc.id, workspaceId })
      }

      if (!res.hasNextPage) break
    }

    return NextResponse.json({ scorecards })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
