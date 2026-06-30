export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { App, ApiSchema, KafkaTopic, KafkaLineageEdge } from '@/payload-types'
import { validateInternalApiKey } from '@/lib/auth/internal-api-auth'
import {
  projectAppEntity,
  projectApiSchemaEntity,
  projectKafkaTopicEntity,
  projectKafkaLineageRelation,
} from '@/lib/catalog/projection'

/**
 * POST /api/internal/catalog/upsert
 *
 * Lets a worker (e.g. the Temporal Kafka lineage workflow) push an entity or
 * relation upsert through the SAME projection lib used by the source-collection
 * hooks, so the unified catalog graph stays consistent regardless of who
 * triggered the change.
 *
 * Auth: X-API-Key validated against ORBIT_INTERNAL_API_KEY (constant-time).
 *
 * Body:
 *   { kind: 'app' | 'api-schema' | 'kafka-topic' | 'kafka-lineage', doc: <source doc> }
 *
 * `doc` is the full source document (matching the source collection's shape);
 * the projection lib maps it onto catalog-entities / catalog-relations and is
 * idempotent, so re-pushes are safe.
 */
type UpsertKind = 'app' | 'api-schema' | 'kafka-topic' | 'kafka-lineage'
const KINDS: readonly UpsertKind[] = ['app', 'api-schema', 'kafka-topic', 'kafka-lineage'] as const
const isKind = (v: unknown): v is UpsertKind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v)

export async function POST(request: NextRequest) {
  const authError = validateInternalApiKey(request.headers.get('X-API-Key'))
  if (authError) return authError

  try {
    const body = await request.json()
    if (!isKind(body.kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${KINDS.join(', ')}` },
        { status: 400 },
      )
    }
    if (!body.doc || typeof body.doc !== 'object') {
      return NextResponse.json({ error: 'doc (source document) is required' }, { status: 400 })
    }

    const payload = await getPayload({ config: configPromise })

    switch (body.kind) {
      case 'app': {
        const id = await projectAppEntity(payload, body.doc as App)
        return NextResponse.json({ type: 'entity', id })
      }
      case 'api-schema': {
        const id = await projectApiSchemaEntity(payload, body.doc as ApiSchema)
        return NextResponse.json({ type: 'entity', id })
      }
      case 'kafka-topic': {
        const id = await projectKafkaTopicEntity(payload, body.doc as KafkaTopic)
        return NextResponse.json({ type: 'entity', id })
      }
      case 'kafka-lineage': {
        const id = await projectKafkaLineageRelation(payload, body.doc as KafkaLineageEdge)
        return NextResponse.json({ type: 'relation', id, skipped: id === null })
      }
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
