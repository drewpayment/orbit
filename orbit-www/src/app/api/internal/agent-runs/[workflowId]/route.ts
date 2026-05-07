export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * PATCH /api/internal/agent-runs/[workflowId]
 *
 * Used by the temporal worker's UpdateAgentRun activity to keep the
 * AgentRuns Payload row in sync with the live workflow state. The row is
 * keyed by workflowId (not Payload's auto id) since that's what the
 * workflow knows.
 *
 * Body shape:
 *   {
 *     patch?: { status?, summary?, endedAt? },        // partial update
 *     appendApproval?: {                              // append to audit array
 *       approvalId, kind, title, resolution,
 *       resolvedBy?, resolvedAt?, notes?
 *     }
 *   }
 *
 * The route is fail-soft: 404s when the row doesn't exist (the workflow
 * may run without a corresponding row, e.g. the gRPC AgentService starts
 * the workflow before the row's been written; the activity tolerates 404
 * and the next call will succeed).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { workflowId } = await context.params
  if (!workflowId) {
    return NextResponse.json({ error: 'workflowId required' }, { status: 400 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const payload = await getPayload({ config: configPromise })

  const found = await payload.find({
    collection: 'agent-runs',
    where: { workflowId: { equals: workflowId } },
    limit: 1,
    overrideAccess: true,
  })
  const run = found.docs[0]
  if (!run) {
    return NextResponse.json({ error: 'agent run not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}
  if (body.patch) {
    if (typeof body.patch.status === 'string') updates.status = body.patch.status
    if (typeof body.patch.summary === 'string') updates.summary = body.patch.summary
    if (typeof body.patch.endedAt === 'string') updates.endedAt = body.patch.endedAt
  }
  if (body.appendApproval && typeof body.appendApproval === 'object') {
    const a = body.appendApproval
    const existing = Array.isArray(run.approvals) ? run.approvals : []
    updates.approvals = [
      ...existing,
      {
        approvalId: a.approvalId,
        kind: a.kind,
        title: a.title,
        resolution: a.resolution, // 'approved' | 'rejected'
        resolvedBy: a.resolvedBy ?? null,
        resolvedAt: a.resolvedAt ?? new Date().toISOString(),
        notes: a.notes ?? '',
      },
    ]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ id: run.id, noop: true })
  }

  try {
    const updated = await payload.update({
      collection: 'agent-runs',
      id: run.id,
      data: updates as any,
      overrideAccess: true,
    })
    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
