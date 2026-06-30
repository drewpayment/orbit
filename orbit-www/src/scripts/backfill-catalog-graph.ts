// orbit-www/src/scripts/backfill-catalog-graph.ts
//
// One-time (idempotent, re-runnable) backfill of the unified catalog graph.
// Iterates every apps, api-schemas, kafka-topics and kafka-lineage-edges row
// and projects each through the shared projection lib, exactly as the source
// collection hooks do on change. Safe to re-run: projection is keyed on
// (source.type, source.sourceId) / (workspace, from, to, type) and upserts.
//
// Usage: cd orbit-www && npx tsx src/scripts/backfill-catalog-graph.ts

import 'dotenv/config'
import { getPayload } from 'payload'
import config from '@payload-config'
import {
  projectAppEntity,
  projectApiSchemaEntity,
  projectKafkaTopicEntity,
  projectKafkaLineageRelation,
} from '@/lib/catalog/projection'

const PAGE_SIZE = 100

async function backfill() {
  const payload = await getPayload({ config })

  const counts = {
    apps: { ok: 0, failed: 0 },
    apiSchemas: { ok: 0, failed: 0 },
    kafkaTopics: { ok: 0, failed: 0 },
    lineageEdges: { ok: 0, skipped: 0, failed: 0 },
  }

  // --- apps -> service entities ---
  console.log('Backfilling apps...')
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: 'apps',
      limit: PAGE_SIZE,
      page,
      overrideAccess: true,
    })
    for (const doc of res.docs) {
      try {
        await projectAppEntity(payload, doc)
        counts.apps.ok++
      } catch (err) {
        counts.apps.failed++
        console.error(`  app ${doc.id} failed:`, (err as Error).message)
      }
    }
    if (!res.hasNextPage) break
  }

  // --- api-schemas -> api entities (+ exposes-api relations) ---
  console.log('Backfilling api-schemas...')
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: 'api-schemas',
      limit: PAGE_SIZE,
      page,
      overrideAccess: true,
    })
    for (const doc of res.docs) {
      try {
        await projectApiSchemaEntity(payload, doc)
        counts.apiSchemas.ok++
      } catch (err) {
        counts.apiSchemas.failed++
        console.error(`  api-schema ${doc.id} failed:`, (err as Error).message)
      }
    }
    if (!res.hasNextPage) break
  }

  // --- kafka-topics -> kafka-topic entities ---
  console.log('Backfilling kafka-topics...')
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: 'kafka-topics',
      limit: PAGE_SIZE,
      page,
      overrideAccess: true,
    })
    for (const doc of res.docs) {
      try {
        await projectKafkaTopicEntity(payload, doc)
        counts.kafkaTopics.ok++
      } catch (err) {
        counts.kafkaTopics.failed++
        console.error(`  kafka-topic ${doc.id} failed:`, (err as Error).message)
      }
    }
    if (!res.hasNextPage) break
  }

  // --- kafka-lineage-edges -> produces/consumes-topic relations ---
  // Projected last so the topic + service entities they reference already exist
  // (the lib also resolves/projects them on demand if not).
  console.log('Backfilling kafka-lineage-edges...')
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: 'kafka-lineage-edges',
      limit: PAGE_SIZE,
      page,
      overrideAccess: true,
    })
    for (const doc of res.docs) {
      try {
        const id = await projectKafkaLineageRelation(payload, doc)
        if (id === null) counts.lineageEdges.skipped++
        else counts.lineageEdges.ok++
      } catch (err) {
        counts.lineageEdges.failed++
        console.error(`  lineage-edge ${doc.id} failed:`, (err as Error).message)
      }
    }
    if (!res.hasNextPage) break
  }

  console.log('\nBackfill complete:')
  console.table(counts)
  process.exit(0)
}

backfill().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
