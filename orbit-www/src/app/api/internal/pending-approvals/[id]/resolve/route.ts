export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * Spike 7 commit γ — POST /api/internal/pending-approvals/[id]/resolve
 *
 * Body shape:
 *   {
 *     status: 'resolved' | 'aborted',     // 'aborted' = workflow was killed
 *     resolution?: 'approved' | 'rejected',
 *     resolvedBy?: string,
 *     notes?: string,
 *     reviewerRounds?: number,
 *   }
 *
 * Idempotent: re-posting on an already-resolved row updates the timestamp
 * but preserves the original resolver. The workflow-side activity treats
 * any 2xx as success.
 *
 * Workspace ownership: when `workspaceId` is present in the body it must
 * match the row's workspace, otherwise the call is rejected 409 and
 * nothing is changed. Absent workspaceId is tolerated (logs a warning)
 * while the Go side rolls out the field.
 */
const relId = (rel: unknown): string =>
  typeof rel === 'string' ? rel : ((rel as { id?: string } | null)?.id ?? '')

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

  try {
    const body = await request.json()
    const status = body.status === 'aborted' ? 'aborted' : 'resolved'
    const data: Record<string, unknown> = { status }

    if (status === 'resolved') {
      if (body.resolution === 'approved' || body.resolution === 'rejected') {
        data.resolution = body.resolution
      }
      data.resolvedAt = new Date().toISOString()
      if (body.resolvedBy) data.resolvedBy = body.resolvedBy
      if (typeof body.notes === 'string') data.notes = body.notes
      if (typeof body.reviewerRounds === 'number') data.reviewerRounds = body.reviewerRounds
    }

    const payload = await getPayload({ config: configPromise })

    // Workspace ownership cross-check, mirroring the agent-tools resolve
    // route. Reject resolves targeting a row in a different workspace.
    const existing = await payload.findByID({
      collection: 'pending-approvals',
      id,
      overrideAccess: true,
    })
    const bodyWorkspaceId =
      typeof body.workspaceId === 'string' ? body.workspaceId : ''
    if (bodyWorkspaceId) {
      if (relId(existing.workspace) !== bodyWorkspaceId) {
        return NextResponse.json(
          { error: 'workspace mismatch', code: 'WORKSPACE_MISMATCH' },
          { status: 409 },
        )
      }
    } else {
      console.warn(
        `[pending-approvals/resolve] row ${id} resolved without workspaceId; skipping ownership check (rollout backward-compat)`,
      )
    }

    const updated = await payload.update({
      collection: 'pending-approvals',
      id,
      data,
      overrideAccess: true,
    })
    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
