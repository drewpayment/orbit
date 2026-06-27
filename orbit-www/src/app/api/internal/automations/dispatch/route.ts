export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { dispatchAutomationEvent } from '@/lib/automations/dispatch'
import type { AutomationEvent, AutomationEventType } from '@/lib/automations/events'

/**
 * POST /api/internal/automations/dispatch
 *
 * Out-of-process entry point for the automation dispatcher (IDP refocus P4).
 * In-process changes are dispatched directly by the afterChange hooks on
 * scorecard-rule-results / catalog-entities; this route exists for the DEFERRED
 * Temporal schedule worker (and any external producer) to push a normalized
 * event, mirroring the other /api/internal/* writeback routes.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Body: a normalized AutomationEvent — minimally { type, workspace, ... }.
 */

const EVENT_TYPES: readonly AutomationEventType[] = [
  'rule-result-changed',
  'entity-changed',
  'schedule',
]

export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.type !== 'string' || !EVENT_TYPES.includes(body.type as AutomationEventType)) {
    return NextResponse.json(
      { error: `type must be one of: ${EVENT_TYPES.join(', ')}` },
      { status: 400 },
    )
  }
  if (typeof body.workspace !== 'string' || !body.workspace) {
    return NextResponse.json({ error: 'workspace (string) is required' }, { status: 400 })
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await dispatchAutomationEvent(payload, body as unknown as AutomationEvent)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
