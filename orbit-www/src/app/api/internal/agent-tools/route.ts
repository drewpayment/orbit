export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * GET /api/internal/agent-tools?workspace_id=…&status=approved
 *
 * Used by the temporal worker to fetch the workspace's approved AgentTools
 * before each LLM step, merging them into the tool catalog the model sees.
 *
 * POST /api/internal/agent-tools
 * { workspaceId, name, description, inputSchemaJson, templateKind,
 *   templateJson, reasoning, createdByRunId }
 *
 * Creates a new pending tool registration. The workflow's register_tool
 * dispatch then awaits an Approve / Reject signal. POST /resolve is in
 * agent-tools/[id]/resolve/route.ts.
 */
export async function GET(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const workspaceId = request.nextUrl.searchParams.get('workspace_id')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })
  }
  const status = request.nextUrl.searchParams.get('status') ?? 'approved'

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await payload.find({
      collection: 'agent-tools',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { status: { equals: status } },
        ],
      },
      limit: 200,
      overrideAccess: true,
    })
    return NextResponse.json({
      tools: result.docs.map((doc) => ({
        id: doc.id,
        name: doc.name,
        description: doc.description,
        inputSchemaJson: doc.inputSchemaJson ?? '',
        templateKind: doc.templateKind,
        templateJson: doc.templateJson,
        status: doc.status,
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
    const required = ['workspaceId', 'name', 'description', 'templateKind', 'templateJson']
    for (const f of required) {
      if (!body[f]) {
        return NextResponse.json({ error: `${f} required` }, { status: 400 })
      }
    }

    const payload = await getPayload({ config: configPromise })

    // Reject collisions on (workspace, name) up-front so the agent gets a
    // clean error message rather than a Mongo-level uniqueness failure.
    const existing = await payload.find({
      collection: 'agent-tools',
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
        { error: `tool name already registered in this workspace`, code: 'NAME_TAKEN' },
        { status: 409 },
      )
    }

    const created = await payload.create({
      collection: 'agent-tools',
      data: {
        workspace: body.workspaceId,
        name: body.name,
        description: body.description,
        inputSchemaJson: body.inputSchemaJson ?? '',
        templateKind: body.templateKind,
        templateJson: body.templateJson,
        reasoning: body.reasoning ?? '',
        status: 'pending',
        createdByRunId: body.createdByRunId ?? '',
      },
      overrideAccess: true,
    })
    return NextResponse.json({ id: created.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
