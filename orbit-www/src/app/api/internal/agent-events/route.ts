export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

/**
 * POST /api/internal/agent-events
 *
 * Durable transcript writer. Called by the temporal worker's
 * PersistAgentEvents activity to replicate the workflow's conversation
 * history into the `agent-events` Payload collection (system of record for
 * the transcript — see AgentEvents.ts).
 *
 * Body:
 *   {
 *     workflowId: string,
 *     workspaceId: string,
 *     events: [{ sequence: number, kind: string, payload: object, emittedAt: string }]
 *   }
 *
 * Behavior:
 *   - Auth via X-API-Key (validateInternalApiKey).
 *   - Resolve the agent-runs row by workflowId → 404 if absent.
 *   - 409 if the run's workspace doesn't match workspaceId.
 *   - Upsert each event keyed on (workflowId, sequence): a sequence that
 *     already exists is skipped (idempotent — activity retries / replays are
 *     no-ops). A unique-index race on create is also treated as a skip.
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const workflowId = typeof body?.workflowId === 'string' ? body.workflowId : ''
  const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : ''
  if (!workflowId || !workspaceId) {
    return NextResponse.json({ error: 'workflowId and workspaceId required' }, { status: 400 })
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

  const runWorkspaceId =
    typeof run.workspace === 'string' ? run.workspace : (run.workspace?.id ?? '')
  if (runWorkspaceId !== workspaceId) {
    return NextResponse.json(
      { error: 'workspace mismatch', code: 'WORKSPACE_MISMATCH' },
      { status: 409 },
    )
  }

  if (!Array.isArray(body.events)) {
    return NextResponse.json({ error: 'events must be an array' }, { status: 400 })
  }

  // Normalize + validate the incoming events.
  type IncomingEvent = { sequence: number; kind: string; payload: unknown; emittedAt: string }
  const events: IncomingEvent[] = []
  for (const raw of body.events) {
    if (!raw || typeof raw !== 'object') continue
    const sequence = Number(raw.sequence)
    const kind = typeof raw.kind === 'string' ? raw.kind : ''
    if (!Number.isFinite(sequence) || !kind || raw.payload == null) continue
    const emittedAt = typeof raw.emittedAt === 'string' ? raw.emittedAt : new Date().toISOString()
    events.push({ sequence, kind, payload: raw.payload, emittedAt })
  }

  if (events.length === 0) {
    return NextResponse.json({ id: run.id, created: 0, skipped: 0 })
  }

  // Pre-filter sequences that already exist so replays are cheap no-ops. The
  // unique (workflowId, sequence) index is the real guard; this just avoids
  // most failed create attempts.
  const sequences = events.map((e) => e.sequence)
  const existing = await payload.find({
    collection: 'agent-events',
    where: {
      and: [{ workflowId: { equals: workflowId } }, { sequence: { in: sequences } }],
    },
    limit: events.length,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  const existingSequences = new Set<number>(
    existing.docs.map((d) => Number((d as { sequence: number }).sequence)),
  )

  let created = 0
  let skipped = 0
  for (const evt of events) {
    if (existingSequences.has(evt.sequence)) {
      skipped += 1
      continue
    }
    try {
      await payload.create({
        collection: 'agent-events',
        data: {
          workspace: workspaceId,
          run: run.id,
          workflowId,
          sequence: evt.sequence,
          kind: evt.kind,
          payload: evt.payload as Record<string, unknown>,
          emittedAt: evt.emittedAt,
        },
        overrideAccess: true,
      })
      created += 1
    } catch (err) {
      // A concurrent writer may have inserted the same (workflowId, sequence)
      // between the pre-filter and this create. The unique index rejects it;
      // treat that as an idempotent skip rather than a failure.
      const msg = (err as Error)?.message ?? ''
      if (/duplicate key|E11000|unique/i.test(msg)) {
        skipped += 1
        continue
      }
      return NextResponse.json({ error: msg, created, skipped }, { status: 500 })
    }
  }

  return NextResponse.json({ id: run.id, created, skipped })
}
