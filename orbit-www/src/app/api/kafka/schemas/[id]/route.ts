export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getActor } from '@/lib/authz'
import { getSchema } from '@/app/(frontend)/workspaces/[slug]/kafka/actions'

/**
 * GET /api/kafka/schemas/[id]
 * Get a schema by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor()

  if (!actor) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { id } = await params
  const result = await getSchema(id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 404 })
  }

  return NextResponse.json({ schema: result.schema })
}
