export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * POST /api/internal/pattern-instances
 *
 * Creates a new PatternInstance row. Called by the temporal worker's
 * CreatePatternInstance activity at the start of the agent's
 * instantiate_pattern dispatch. Returns { id } so the workflow can PATCH
 * status updates back to the same row.
 *
 * Body:
 *   {
 *     workspaceId,
 *     patternId,
 *     patternVersion,
 *     name,
 *     parameters (object),
 *     appId? (optional),
 *     createdByUser?,
 *     createdByRunId?,
 *     workflowId? (the agent run's workflow id for v1),
 *   }
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const body = await request.json()
    const required = ['workspaceId', 'patternId', 'patternVersion', 'name', 'parameters']
    for (const f of required) {
      if (body[f] === undefined || body[f] === null) {
        return NextResponse.json({ error: `${f} required` }, { status: 400 })
      }
    }
    if (typeof body.parameters !== 'object') {
      return NextResponse.json({ error: 'parameters must be an object' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })

    // Reject (workspace, name) collisions up-front so the agent gets a
    // clean message rather than a Mongo uniqueness error.
    const existing = await payload.find({
      collection: 'pattern-instances',
      where: {
        and: [
          { workspace: { equals: body.workspaceId } },
          { name: { equals: body.name } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      return NextResponse.json(
        { error: 'instance name already exists in this workspace', code: 'NAME_TAKEN' },
        { status: 409 },
      )
    }

    const created = await payload.create({
      collection: 'pattern-instances',
      data: {
        workspace: body.workspaceId,
        pattern: body.patternId,
        patternVersion: body.patternVersion,
        name: body.name,
        app: body.appId ?? null,
        parameters: body.parameters,
        status: 'pending',
        workflowId: body.workflowId ?? '',
        createdByUser: body.createdByUser ?? null,
        createdByRunId: body.createdByRunId ?? '',
      },
      overrideAccess: true,
    })
    return NextResponse.json({ id: created.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
