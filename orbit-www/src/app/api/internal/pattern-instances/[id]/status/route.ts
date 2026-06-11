export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { PatternInstance } from '@/payload-types'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'

type Status = PatternInstance['status']
const STATUSES: readonly Status[] = [
  'pending',
  'validating',
  'provisioning',
  'active',
  'failed',
  'deprovisioning',
  'deprovisioned',
] as const
const isStatus = (v: unknown): v is Status =>
  typeof v === 'string' && (STATUSES as readonly string[]).includes(v)


/**
 * PATCH /api/internal/pattern-instances/[id]/status
 *
 * Writes the temporal worker's view of an instance's lifecycle back to
 * Payload. Mirrors /api/internal/apps/[id]/status. Called by the agent's
 * instantiate_pattern dispatch as it transitions the instance through
 * validating → provisioning → active|failed.
 *
 * Body:
 *   { status: Status, outputs?: object, errorMessage?: string }
 */
export async function PATCH(
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
    if (!isStatus(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    const payload = await getPayload({ config: configPromise })
    const data: Partial<PatternInstance> = { status: body.status }
    if (body.outputs !== undefined && body.outputs !== null) {
      if (typeof body.outputs !== 'object') {
        return NextResponse.json({ error: 'outputs must be an object' }, { status: 400 })
      }
      data.outputs = body.outputs
    }
    if (typeof body.errorMessage === 'string') {
      data.errorMessage = body.errorMessage
    }

    const updated = await payload.update({
      collection: 'pattern-instances',
      id,
      data,
      overrideAccess: true,
    })
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
    })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'pattern instance not found' }, { status: 404 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
