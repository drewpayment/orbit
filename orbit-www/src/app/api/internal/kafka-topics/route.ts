export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { Where } from 'payload'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'


/**
 * GET /api/internal/kafka-topics
 * Queries Kafka topics with optional filters.
 * Used by Temporal workflows to find topics for sync and decommissioning.
 */
export async function GET(request: NextRequest) {
  // Validate API key
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const payload = await getPayload({ config: configPromise })
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const depth = parseInt(searchParams.get('depth') || '0', 10)
    const limit = parseInt(searchParams.get('limit') || '10', 10)

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
      collection: 'kafka-topics',
      where: Object.keys(where).length > 0 ? where : undefined,
      depth,
      limit,
      overrideAccess: true,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[Internal API] Kafka topics query error:', error)

    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/internal/kafka-topics
 *
 * Creates the kafka-topics row for the kafka:topic:provision scaffolder
 * action (see temporal-workflows'
 * services.PayloadKafkaTopicClient / actions.KafkaTopicProvision). The row
 * is created directly in `provisioning` status — the normal
 * pending-approval → human-approve flow the Kafka UI drives is bypassed
 * here, since a scaffolder step is expected to provision immediately; a
 * template author who wants a gate uses a separate `approval:request` step
 * ahead of it.
 *
 * Body:
 *   {
 *     workspaceId: string,
 *     virtualClusterId: string,
 *     name: string,
 *     description?: string,
 *     environment?: string,      // defaults to "dev"
 *     partitions?: number,       // defaults to 3
 *     retentionMs?: number,
 *     owner?: string,            // kafka-topics has no owner field today;
 *                                 // stored as a tag (owner:<value>)
 *   }
 *
 * A `virtualClusterId` that doesn't resolve to a kafka-virtual-clusters doc
 * returns 404 { code: 'NOT_FOUND' } — the Go client maps this specifically
 * to ErrKafkaVirtualClusterNotFound, which the action treats as
 * scaffolder.ErrInvalidInput (non-retryable).
 *
 * Idempotency: a row already created for the same
 * (workspace, virtualCluster, name) is returned as-is (200) rather than
 * duplicated — a Temporal retry of the kafka:topic:provision step is safe
 * to re-run.
 *
 * Response: 201 { id, status, fullTopicName, partitions } on create, or 200
 * with the same shape on the idempotent already-exists path.
 */
export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const requiredStrings = ['workspaceId', 'virtualClusterId', 'name']
  for (const field of requiredStrings) {
    if (typeof body[field] !== 'string' || (body[field] as string).trim() === '') {
      return NextResponse.json({ error: `${field} required` }, { status: 400 })
    }
  }

  const workspaceId = body.workspaceId as string
  const virtualClusterId = body.virtualClusterId as string
  const name = body.name as string
  const description = typeof body.description === 'string' ? body.description : undefined
  const environment =
    typeof body.environment === 'string' && body.environment.trim() !== ''
      ? body.environment
      : 'dev'
  const partitions =
    typeof body.partitions === 'number' && Number.isFinite(body.partitions) && body.partitions > 0
      ? Math.floor(body.partitions)
      : 3
  const retentionMs =
    typeof body.retentionMs === 'number' && Number.isFinite(body.retentionMs) && body.retentionMs > 0
      ? Math.floor(body.retentionMs)
      : undefined
  const owner = typeof body.owner === 'string' && body.owner.trim() !== '' ? body.owner : undefined

  try {
    const payload = await getPayload({ config: configPromise })

    try {
      await payload.findByID({
        collection: 'kafka-virtual-clusters',
        id: virtualClusterId,
        depth: 0,
        overrideAccess: true,
      })
    } catch {
      return NextResponse.json(
        { error: 'virtual cluster not found', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const existing = await payload.find({
      collection: 'kafka-topics',
      where: {
        and: [
          { workspace: { equals: workspaceId } },
          { virtualCluster: { equals: virtualClusterId } },
          { name: { equals: name } },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      const doc = existing.docs[0]
      return NextResponse.json({
        id: String(doc.id),
        status: doc.status,
        fullTopicName: doc.fullTopicName ?? '',
        partitions: doc.partitions,
      })
    }

    const created = await payload.create({
      collection: 'kafka-topics',
      data: {
        workspace: workspaceId,
        virtualCluster: virtualClusterId,
        name,
        description,
        environment,
        partitions,
        replicationFactor: 3,
        ...(retentionMs !== undefined ? { retentionMs } : {}),
        status: 'provisioning',
        approvalRequired: false,
        createdVia: 'api',
        ...(owner ? { tags: [{ tag: `owner:${owner}` }] } : {}),
      },
      overrideAccess: true,
    })

    return NextResponse.json(
      {
        id: String(created.id),
        status: created.status,
        fullTopicName: created.fullTopicName ?? '',
        partitions: created.partitions,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('[Internal API] Kafka topic create error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
