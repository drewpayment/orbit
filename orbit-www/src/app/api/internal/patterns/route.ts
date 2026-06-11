export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload, type Where } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * GET /api/internal/patterns?status=approved&category=…
 *
 * Used by the temporal worker to fetch the platform-wide approved Patterns
 * before each agent LLM step. The catalog merges into the LLM's tool
 * descriptors as a single `instantiate_pattern` tool with pattern_id
 * selection — the LLM picks structurally from the listed catalog.
 *
 * POST /api/internal/patterns
 * { name, displayName, description, category, templateKind, templateJson,
 *   inputSchemaJson, reasoning, createdByRunId, createdByUser }
 *
 * Creates a new pending pattern registration. The workflow's
 * propose_pattern dispatch then awaits an Approve / Reject signal.
 * POST /resolve is in patterns/[id]/resolve/route.ts.
 */
export async function GET(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  const status = request.nextUrl.searchParams.get('status') ?? 'approved'
  const category = request.nextUrl.searchParams.get('category')

  try {
    const payload = await getPayload({ config: configPromise })
    const filters: Where[] = [{ status: { equals: status } }]
    if (category) {
      filters.push({ category: { equals: category } })
    }
    const result = await payload.find({
      collection: 'patterns',
      where: { and: filters },
      limit: 200,
      overrideAccess: true,
    })
    return NextResponse.json({
      patterns: result.docs.map((doc) => ({
        id: doc.id,
        name: doc.name,
        displayName: doc.displayName,
        description: doc.description,
        category: doc.category,
        templateKind: doc.templateKind,
        templateJson: doc.templateJson,
        inputSchemaJson: doc.inputSchemaJson,
        status: doc.status,
        currentVersion: doc.currentVersion ?? 1,
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
    const required = [
      'name',
      'displayName',
      'description',
      'category',
      'templateKind',
      'templateJson',
      'inputSchemaJson',
    ]
    for (const f of required) {
      if (!body[f]) {
        return NextResponse.json({ error: `${f} required` }, { status: 400 })
      }
    }

    const payload = await getPayload({ config: configPromise })

    // Pattern names are globally unique — reject up-front so the agent
    // gets a clean error rather than a Mongo-level uniqueness failure.
    const existing = await payload.find({
      collection: 'patterns',
      where: { name: { equals: body.name } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      return NextResponse.json(
        { error: 'pattern name already registered', code: 'NAME_TAKEN' },
        { status: 409 },
      )
    }

    const created = await payload.create({
      collection: 'patterns',
      data: {
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        category: body.category,
        templateKind: body.templateKind,
        templateJson: body.templateJson,
        inputSchemaJson: body.inputSchemaJson,
        reasoning: body.reasoning ?? '',
        status: 'pending',
        createdByRunId: body.createdByRunId ?? '',
        createdByUser: body.createdByUser ?? null,
      },
      overrideAccess: true,
    })
    return NextResponse.json({ id: created.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
