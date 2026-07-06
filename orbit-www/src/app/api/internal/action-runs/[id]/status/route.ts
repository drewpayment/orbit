export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { ActionRun } from '@/payload-types'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { readLogs, type RunLogEntry } from '@/lib/actions/run'

/**
 * POST /api/internal/action-runs/[id]/status
 *
 * Write-back endpoint for the (deferred) Temporal ActionDispatch worker to
 * advance a Temporal-backed action-run as it progresses: set status, append
 * log lines, and record outputs/error/workflowId. Mirrors the catalog upsert
 * route's auth model (X-API-Key → ORBIT_INTERNAL_API_KEY, constant-time).
 *
 * Body (all optional except an implicit at-least-one):
 *   {
 *     status?: 'pending'|'awaiting-approval'|'running'|'succeeded'|'failed',
 *     appendLogs?: { ts?: string, level?: 'info'|'warn'|'error', message: string }[],
 *     outputs?: object,
 *     error?: string,
 *     workflowId?: string,
 *     entity?: string   // catalog-entities id this run produced
 *   }
 *
 * Logs are APPENDED to the run's existing log array (never replaced).
 */

const STATUSES: readonly ActionRun['status'][] = [
  'pending',
  'awaiting-approval',
  'running',
  'succeeded',
  'failed',
]
const isStatus = (v: unknown): v is ActionRun['status'] =>
  typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

/** Coerce a caller-supplied log entry into a clean {@link RunLogEntry}. */
function normalizeLog(entry: unknown): RunLogEntry | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>
  if (typeof e.message !== 'string' || !e.message.trim()) return null
  const level =
    e.level === 'warn' || e.level === 'error' ? e.level : 'info'
  const ts = typeof e.ts === 'string' && e.ts ? e.ts : new Date().toISOString()
  return { ts, level, message: e.message }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const payload = await getPayload({ config: configPromise })

  let run: ActionRun
  try {
    run = await payload.findByID({
      collection: 'action-runs',
      id,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const data: Record<string, unknown> = {}
  if (isStatus(body.status)) data.status = body.status
  if (body.outputs !== undefined) data.outputs = body.outputs
  if (typeof body.error === 'string') data.error = body.error
  if (typeof body.workflowId === 'string') data.workflowId = body.workflowId
  if (typeof body.entity === 'string') data.entity = body.entity

  if (Array.isArray(body.appendLogs)) {
    const logs = readLogs(run)
    for (const raw of body.appendLogs) {
      const entry = normalizeLog(raw)
      if (entry) logs.push(entry)
    }
    data.logs = logs
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update (provide status, appendLogs, outputs, error, workflowId, or entity)' },
      { status: 400 },
    )
  }

  const updated = await payload.update({
    collection: 'action-runs',
    id,
    data,
    overrideAccess: true,
  })

  return NextResponse.json({ id: updated.id, status: updated.status })
}
