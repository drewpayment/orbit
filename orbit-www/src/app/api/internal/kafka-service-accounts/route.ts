import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { Where } from 'payload'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

/**
 * GET /api/internal/kafka-service-accounts
 * Queries Kafka service accounts with optional filters.
 * Used by Temporal workflows for decommissioning and credential management.
 */
export async function GET(request: NextRequest) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const depth = parseInt(searchParams.get('depth') || '0', 10)
    const limit = parseInt(searchParams.get('limit') || '100', 10)

    // Build where clause from query params
    const where: Where = {}

    for (const [key, value] of searchParams.entries()) {
      const whereMatch = key.match(/^where\[(\w+)]\[(\w+)]$/)
      if (whereMatch) {
        const [, field, operator] = whereMatch
        if (!where[field]) {
          where[field] = {}
        }
        let parsedValue: string | boolean = value
        if (value === 'true') parsedValue = true
        if (value === 'false') parsedValue = false
        ;(where[field] as Record<string, unknown>)[operator] = parsedValue
      }
    }

    const result = await payload.find({
      collection: 'kafka-service-accounts',
      where: Object.keys(where).length > 0 ? where : undefined,
      depth,
      limit,
      overrideAccess: true,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Internal API] Kafka service accounts query error:', error)

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
