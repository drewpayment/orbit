export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import { ingestScan, parseBody } from '@/lib/discovery/ingest'

/**
 * POST /api/internal/discovery/ingest — HTTP shell only; the contract and core
 * logic live in `@/lib/discovery/ingest` (Next's generated route types allow
 * only HTTP-handler exports from route files).
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time),
 * same guard as `POST /api/internal/catalog/upsert`.
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const body = parseBody(raw)
  if (!body) {
    return NextResponse.json(
      {
        error:
          'Malformed body: expected { installationId, workspaceId, repo{owner,name}, bundle{tree,files} }',
      },
      { status: 400 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const counts = await ingestScan(payload, body)
    return NextResponse.json(counts)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
