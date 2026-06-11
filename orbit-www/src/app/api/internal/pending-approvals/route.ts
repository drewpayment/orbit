export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * Spike 7 commit γ — Internal API for the PendingApprovals collection.
 *
 * GET /api/internal/pending-approvals?workspace_id=…&status=pending
 *   Lists rows. Used by the worker for replay/debug; the queue page reads
 *   directly through Payload locally.
 *
 * POST /api/internal/pending-approvals
 *   {
 *     workspaceId, workflowId, runId, agentRunId?, approvalId,
 *     kind, title, bodyMarkdown?, payload?
 *   }
 *
 *   Idempotent on (workflowId, approvalId): if a row already exists the
 *   route returns 200 with the existing id rather than 409. This lets a
 *   continue-as-new workflow re-emit OpenPendingApproval safely.
 *
 * Resolution lives in pending-approvals/[id]/resolve/route.ts.
 */
export async function GET(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const workspaceId = request.nextUrl.searchParams.get('workspace_id')
  const status = request.nextUrl.searchParams.get('status') ?? 'pending'
  const workflowId = request.nextUrl.searchParams.get('workflow_id')
  const approvalId = request.nextUrl.searchParams.get('approval_id')

  try {
    const payload = await getPayload({ config: configPromise })
    const where: any[] = [{ status: { equals: status } }]
    if (workspaceId) where.push({ workspace: { equals: workspaceId } })
    if (workflowId) where.push({ workflowId: { equals: workflowId } })
    if (approvalId) where.push({ approvalId: { equals: approvalId } })

    const result = await payload.find({
      collection: 'pending-approvals',
      where: { and: where },
      limit: 200,
      sort: '-createdAt',
      overrideAccess: true,
    })
    return NextResponse.json({
      rows: result.docs.map((doc) => ({
        id: doc.id,
        workspaceId: typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id ?? '',
        workflowId: doc.workflowId,
        runId: doc.runId ?? '',
        approvalId: doc.approvalId,
        kind: doc.kind,
        title: doc.title,
        status: doc.status,
        createdAt: doc.createdAt,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const body = await request.json()
    const required = ['workspaceId', 'workflowId', 'approvalId', 'kind', 'title']
    for (const f of required) {
      if (!body[f]) {
        return NextResponse.json({ error: `${f} required` }, { status: 400 })
      }
    }

    const payload = await getPayload({ config: configPromise })

    // Idempotency: continue-as-new replays would otherwise create duplicates.
    const existing = await payload.find({
      collection: 'pending-approvals',
      where: {
        and: [
          { workflowId: { equals: body.workflowId } },
          { approvalId: { equals: body.approvalId } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      return NextResponse.json({ id: existing.docs[0].id, alreadyExisted: true })
    }

    const created = await payload.create({
      collection: 'pending-approvals',
      data: {
        workspace: body.workspaceId,
        workflowId: body.workflowId,
        runId: body.runId ?? '',
        agentRun: body.agentRunId || undefined,
        approvalId: body.approvalId,
        kind: body.kind,
        title: body.title,
        bodyMarkdown: body.bodyMarkdown ?? '',
        payload: body.payload ?? {},
        status: 'pending',
        reviewerRounds: 0,
      },
      overrideAccess: true,
    })
    return NextResponse.json({ id: created.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
