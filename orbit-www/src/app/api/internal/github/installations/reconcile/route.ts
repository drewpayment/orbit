export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { ensureGitHubTokenRefreshWorkflow, signalGitHubTokenRefresh } from '@/lib/temporal/client'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


// Refresh-soon window: signal a running workflow to refresh when the token is
// within this of expiry, so reconciliation also rescues near-expiry tokens.
const REFRESH_SOON_MS = 10 * 60_000

/**
 * Reconciliation backstop. For every installation that should have a running
 * token refresh workflow, ensure one is running (idempotent) and nudge a
 * refresh if its token is at/near expiry. This recovers installations orphaned
 * by a missed webhook or a worker restart, and doubles as the backfill that
 * starts workflows for installations created before this system existed.
 *
 * Excludes `suspended` (recovered via the unsuspend webhook) and
 * `needs_reconnect` (terminal — requires a human).
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const payload = await getPayload({ config: configPromise })

    const candidates = await payload.find({
      collection: 'github-installations',
      where: {
        status: { not_in: ['suspended', 'needs_reconnect'] },
      },
      limit: 500,
      overrideAccess: true,
    })

    let checked = 0
    let started = 0
    let signaled = 0
    let failed = 0

    for (const inst of candidates.docs) {
      checked++
      const wasRunning = inst.temporalWorkflowStatus === 'running'

      const workflowId = await ensureGitHubTokenRefreshWorkflow(inst.id as string)
      if (!workflowId) {
        failed++
        continue
      }

      if (!wasRunning) {
        started++
        await payload.update({
          collection: 'github-installations',
          id: inst.id,
          data: { temporalWorkflowId: workflowId, temporalWorkflowStatus: 'running' },
          overrideAccess: true,
        })
      }

      const expiresAt = inst.tokenExpiresAt ? new Date(inst.tokenExpiresAt as string) : null
      if (!expiresAt || expiresAt.getTime() <= Date.now() + REFRESH_SOON_MS) {
        await signalGitHubTokenRefresh(inst.id as string)
        signaled++
      }
    }

    console.log('[GitHub Reconcile]', { checked, started, signaled, failed })
    return NextResponse.json({ checked, started, signaled, failed })
  } catch (error) {
    console.error('[GitHub Reconcile] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
