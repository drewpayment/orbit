import type { Payload } from 'payload'
import type {
  App,
  ApiSchema,
  KafkaApplication,
  KafkaLineageEdge,
  KafkaTopic,
} from '@/payload-types'
import { slugify } from './entity-crud'

/**
 * Catalog projection layer (IDP refocus P1).
 *
 * Source collections (apps, api-schemas, kafka-topics, kafka-lineage-edges)
 * remain the system of record. This module keeps the unified catalog graph
 * (catalog-entities + catalog-relations) in sync by idempotently upserting one
 * projected row per source record.
 *
 * Idempotency is enforced in code, NOT by DB unique constraints:
 *   - one catalog-entities row per (source.type, source.sourceId)
 *   - one catalog-relations row per (workspace, from, to, type)
 * Every call queries-before-writing: find existing → update, else create.
 *
 * All payload calls use `overrideAccess: true` — projection runs from source
 * hooks and workers that have no user context. Projection only ever writes to
 * catalog-entities / catalog-relations, never back to a source collection, so
 * there is no hook feedback loop.
 *
 * See docs/plans/2026-06-27-idp-refocus-implementation.md (P1).
 */

/** A relationship field value: either the raw id or the populated doc. */
type Ref<T extends { id: string }> = string | T | null | undefined

/** Resolve a relationship field to its id (handles populated or raw). */
function relId<T extends { id: string }>(ref: Ref<T>): string | undefined {
  if (!ref) return undefined
  if (typeof ref === 'string') return ref
  return ref.id
}

// slugify is defined canonically in ./entity-crud (client-safe) and re-exported
// here for back-compat with `import { slugify } from './projection'`.
export { slugify }

/** Provenance values used by entity projections. */
type EntitySource = { type: 'apps' | 'api-schemas' | 'kafka'; sourceId: string }

/** Provenance values used by relation projections. */
type RelationSource = { type: 'apps' | 'api-schemas' | 'kafka-lineage'; sourceId: string }

/** Shape of the data we project onto a catalog-entities row. */
interface EntityData {
  name: string
  slug: string
  kind: 'service' | 'api' | 'kafka-topic'
  workspace: string
  description?: string | null
  health?: 'healthy' | 'degraded' | 'down' | 'unknown'
  lifecycle?: 'experimental' | 'production' | 'deprecated'
  links?: { label: string; url: string; type?: 'repository' | 'docs' | 'other' }[]
  metadata?: Record<string, unknown>
}

/**
 * Merge incoming projected data onto an existing catalog-entities row for the
 * UPDATE path, honouring the field-ownership policy (PM decision 3): identity
 * fields the projection owns (name, slug, kind, workspace, health) are always
 * written; curation fields (description, lifecycle, links, metadata) are
 * SET-IF-ABSENT — written only when the existing row has no human-entered value
 * — so re-projecting a source never clobbers manual edits. `source`, `tier`,
 * `owner`, `subtype` and `runtime` are never written by the projection (the
 * latter two are pure human curation), so they are always preserved on re-sync.
 * Pure + unit-tested.
 */
export function mergeProjectionUpdate(
  existing: {
    description?: string | null
    lifecycle?: string | null
    links?: unknown[] | null
    metadata?: unknown
    // Present on the row but never touched here — projection owns identity, not
    // these curation refinements. Typed loosely so callers can pass the raw doc.
    subtype?: unknown
    runtime?: unknown
  },
  data: EntityData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: data.name,
    slug: data.slug,
    kind: data.kind,
    workspace: data.workspace,
  }
  if (data.health) out.health = data.health

  if (isBlank(existing.description)) out.description = data.description ?? null
  if (data.lifecycle && isBlank(existing.lifecycle)) out.lifecycle = data.lifecycle
  if (data.links && isEmptyArray(existing.links)) out.links = data.links
  if (data.metadata && isEmptyMetadata(existing.metadata)) out.metadata = data.metadata

  return out
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

function isEmptyArray(v: unknown): boolean {
  return !Array.isArray(v) || v.length === 0
}

function isEmptyMetadata(v: unknown): boolean {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

/**
 * Idempotently upsert one catalog-entities row keyed on (source.type,
 * source.sourceId). Returns the entity id.
 */
async function upsertEntity(
  payload: Payload,
  source: EntitySource,
  data: EntityData,
): Promise<string> {
  const existing = await payload.find({
    collection: 'catalog-entities',
    where: {
      and: [
        { 'source.type': { equals: source.type } },
        { 'source.sourceId': { equals: source.sourceId } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  const fields = {
    name: data.name,
    slug: data.slug,
    kind: data.kind,
    workspace: data.workspace,
    description: data.description ?? null,
    ...(data.health ? { health: data.health } : {}),
    ...(data.lifecycle ? { lifecycle: data.lifecycle } : {}),
    ...(data.links ? { links: data.links } : {}),
    ...(data.metadata ? { metadata: data.metadata } : {}),
  }

  if (existing.docs.length > 0) {
    const updated = await payload.update({
      collection: 'catalog-entities',
      id: existing.docs[0].id,
      // set-if-absent for curation fields so a re-sync never clobbers manual edits.
      data: mergeProjectionUpdate(existing.docs[0], data),
      overrideAccess: true,
    })
    return updated.id
  }

  const created = await payload.create({
    collection: 'catalog-entities',
    data: { ...fields, source: { type: source.type, sourceId: source.sourceId } },
    overrideAccess: true,
  })
  return created.id
}

/**
 * Idempotently upsert one catalog-relations row keyed on (workspace, from, to,
 * type). Returns the relation id.
 */
async function upsertRelation(
  payload: Payload,
  rel: {
    workspace: string
    from: string
    to: string
    type: 'exposes-api' | 'produces-topic' | 'consumes-topic'
    source: RelationSource
    metadata?: Record<string, unknown>
  },
): Promise<string> {
  const existing = await payload.find({
    collection: 'catalog-relations',
    where: {
      and: [
        { workspace: { equals: rel.workspace } },
        { from: { equals: rel.from } },
        { to: { equals: rel.to } },
        { type: { equals: rel.type } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  const fields = {
    workspace: rel.workspace,
    from: rel.from,
    to: rel.to,
    type: rel.type,
    ...(rel.metadata ? { metadata: rel.metadata } : {}),
  }

  if (existing.docs.length > 0) {
    const updated = await payload.update({
      collection: 'catalog-relations',
      id: existing.docs[0].id,
      data: fields,
      overrideAccess: true,
    })
    return updated.id
  }

  const created = await payload.create({
    collection: 'catalog-relations',
    data: { ...fields, source: { type: rel.source.type, sourceId: rel.source.sourceId } },
    overrideAccess: true,
  })
  return created.id
}

/** Find an already-projected entity id by source, or undefined. */
async function findEntityIdBySource(
  payload: Payload,
  type: EntitySource['type'],
  sourceId: string,
): Promise<string | undefined> {
  const found = await payload.find({
    collection: 'catalog-entities',
    where: {
      and: [
        { 'source.type': { equals: type } },
        { 'source.sourceId': { equals: sourceId } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })
  return found.docs[0]?.id
}

// ---------------------------------------------------------------------------
// Entity projections
// ---------------------------------------------------------------------------

/**
 * Project an `apps` row → catalog-entities (kind `service`).
 * - health folds in directly from app.status (same enum).
 * - a `repository` link is added when app.repository.url is present.
 * - metadata carries a build/latestBuild summary for scorecards (P2).
 */
export async function projectAppEntity(payload: Payload, app: App): Promise<string> {
  const workspace = relId(app.workspace)
  if (!workspace) throw new Error(`app ${app.id} has no workspace; cannot project`)

  const links: EntityData['links'] = []
  if (app.repository?.url) {
    links.push({ label: 'Repository', url: app.repository.url, type: 'repository' })
  }

  const metadata: Record<string, unknown> = {}
  if (app.buildConfig) {
    metadata.build = {
      language: app.buildConfig.language ?? null,
      framework: app.buildConfig.framework ?? null,
    }
  }
  if (app.latestBuild) {
    metadata.latestBuild = {
      status: app.latestBuild.status ?? null,
      imageTag: app.latestBuild.imageTag ?? null,
      builtAt: app.latestBuild.builtAt ?? null,
    }
  }

  return upsertEntity(
    payload,
    { type: 'apps', sourceId: app.id },
    {
      name: app.name,
      slug: slugify(app.name),
      kind: 'service',
      workspace,
      description: app.description,
      health: (app.status ?? 'unknown') as EntityData['health'],
      links: links.length > 0 ? links : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    },
  )
}

/** Map an api-schema lifecycle status → catalog lifecycle. */
function apiLifecycle(status: ApiSchema['status']): EntityData['lifecycle'] {
  switch (status) {
    case 'published':
      return 'production'
    case 'deprecated':
      return 'deprecated'
    case 'draft':
    default:
      return 'experimental'
  }
}

/**
 * Project an `api-schemas` row → catalog-entities (kind `api`).
 *
 * When the schema links to an app (its `repository` relationship), an
 * `exposes-api` relation (app → api) is also projected. The linked app entity
 * is resolved if already projected, else projected on demand from its source
 * doc.
 */
export async function projectApiSchemaEntity(payload: Payload, doc: ApiSchema): Promise<string> {
  const workspace = relId(doc.workspace)
  if (!workspace) throw new Error(`api-schema ${doc.id} has no workspace; cannot project`)

  const entityId = await upsertEntity(
    payload,
    { type: 'api-schemas', sourceId: doc.id },
    {
      name: doc.name,
      slug: doc.slug || slugify(doc.name),
      kind: 'api',
      workspace,
      description: doc.description ?? doc.specDescription,
      lifecycle: apiLifecycle(doc.status),
      metadata: {
        schemaType: doc.schemaType ?? null,
        currentVersion: doc.currentVersion ?? null,
        status: doc.status ?? null,
        visibility: doc.visibility ?? null,
        endpointCount: doc.endpointCount ?? null,
      },
    },
  )

  // exposes-api: the schema's `repository` field links it to an owning app.
  const appId = relId(doc.repository as Ref<App>)
  if (appId) {
    let appEntityId = await findEntityIdBySource(payload, 'apps', appId)
    if (!appEntityId) {
      try {
        const app = await payload.findByID({
          collection: 'apps',
          id: appId,
          overrideAccess: true,
        })
        appEntityId = await projectAppEntity(payload, app)
      } catch (err) {
        console.warn(
          `[catalog] exposes-api skipped: app ${appId} for api-schema ${doc.id} not resolvable:`,
          err,
        )
      }
    }
    if (appEntityId) {
      await upsertRelation(payload, {
        workspace,
        from: appEntityId,
        to: entityId,
        type: 'exposes-api',
        source: { type: 'api-schemas', sourceId: doc.id },
      })
    }
  }

  return entityId
}

/** Map a kafka-topic provisioning status → a coarse health badge. */
function topicHealth(status: KafkaTopic['status']): EntityData['health'] {
  switch (status) {
    case 'active':
      return 'healthy'
    case 'failed':
      return 'down'
    default:
      return 'unknown'
  }
}

/**
 * Project a `kafka-topics` row → catalog-entities (kind `kafka-topic`).
 */
export async function projectKafkaTopicEntity(payload: Payload, doc: KafkaTopic): Promise<string> {
  const workspace = relId(doc.workspace)
  if (!workspace) throw new Error(`kafka-topic ${doc.id} has no workspace; cannot project`)

  return upsertEntity(
    payload,
    { type: 'kafka', sourceId: doc.id },
    {
      name: doc.name,
      slug: slugify(doc.fullTopicName || doc.name),
      kind: 'kafka-topic',
      workspace,
      description: doc.description,
      health: topicHealth(doc.status),
      metadata: {
        environment: doc.environment ?? null,
        partitions: doc.partitions ?? null,
        status: doc.status ?? null,
        visibility: doc.visibility ?? null,
        fullTopicName: doc.fullTopicName ?? null,
      },
    },
  )
}

/**
 * Project a `kafka-applications` row → catalog-entities (kind `service`).
 * Used to resolve the producing/consuming side of a lineage relation. Kafka
 * applications share the `kafka` source type with topics; the source.sourceId
 * (distinct collection ids) keeps them idempotently separate.
 */
export async function projectKafkaApplicationEntity(
  payload: Payload,
  doc: KafkaApplication,
): Promise<string> {
  const workspace = relId(doc.workspace)
  if (!workspace) throw new Error(`kafka-application ${doc.id} has no workspace; cannot project`)

  return upsertEntity(
    payload,
    { type: 'kafka', sourceId: doc.id },
    {
      name: doc.name,
      slug: doc.slug || slugify(doc.name),
      kind: 'service',
      workspace,
      description: doc.description,
      metadata: { kafkaApplication: true, status: doc.status ?? null },
    },
  )
}

// ---------------------------------------------------------------------------
// Relation projections (Kafka lineage — the differentiator)
// ---------------------------------------------------------------------------

/**
 * Project a `kafka-lineage-edges` row → catalog-relations.
 *
 * direction `produce`  → produces-topic (service → topic)
 * direction `consume`  → consumes-topic (service → topic)
 *
 * Resolves both the topic entity and the producing/consuming service entity,
 * projecting them on demand from their source docs if they are not in the graph
 * yet. Skips (with a logged note) when the edge lacks a topic or source
 * application, or when those source docs are not resolvable.
 *
 * Returns the relation id, or null when skipped.
 */
export async function projectKafkaLineageRelation(
  payload: Payload,
  edge: KafkaLineageEdge,
): Promise<string | null> {
  const topicId = relId(edge.topic as Ref<KafkaTopic>)
  const appId = relId(edge.sourceApplication as Ref<KafkaApplication>)
  const workspace = relId(edge.targetWorkspace as Ref<{ id: string }>)

  if (!topicId) {
    console.warn(`[catalog] lineage edge ${edge.id} has no topic; skipping relation`)
    return null
  }
  if (!appId) {
    console.warn(
      `[catalog] lineage edge ${edge.id} has no sourceApplication; skipping relation`,
    )
    return null
  }
  if (!workspace) {
    console.warn(`[catalog] lineage edge ${edge.id} has no targetWorkspace; skipping relation`)
    return null
  }

  // Resolve (or project) the topic entity.
  let topicEntityId = await findEntityIdBySource(payload, 'kafka', topicId)
  if (!topicEntityId) {
    try {
      const topic = await payload.findByID({
        collection: 'kafka-topics',
        id: topicId,
        overrideAccess: true,
      })
      topicEntityId = await projectKafkaTopicEntity(payload, topic)
    } catch (err) {
      console.warn(`[catalog] lineage edge ${edge.id}: topic ${topicId} not resolvable:`, err)
      return null
    }
  }

  // Resolve (or project) the producing/consuming service entity.
  let serviceEntityId = await findEntityIdBySource(payload, 'kafka', appId)
  if (!serviceEntityId) {
    try {
      const app = await payload.findByID({
        collection: 'kafka-applications',
        id: appId,
        overrideAccess: true,
      })
      serviceEntityId = await projectKafkaApplicationEntity(payload, app)
    } catch (err) {
      console.warn(
        `[catalog] lineage edge ${edge.id}: sourceApplication ${appId} not resolvable:`,
        err,
      )
      return null
    }
  }

  const type = edge.direction === 'produce' ? 'produces-topic' : 'consumes-topic'

  return upsertRelation(payload, {
    workspace,
    from: serviceEntityId,
    to: topicEntityId,
    type,
    source: { type: 'kafka-lineage', sourceId: edge.id },
    metadata: {
      direction: edge.direction,
      bytesAllTime: edge.bytesAllTime ?? null,
      messagesAllTime: edge.messagesAllTime ?? null,
      isActive: edge.isActive ?? null,
      isCrossWorkspace: edge.isCrossWorkspace ?? null,
    },
  })
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

/** Delete every relation whose `from` or `to` references the given entity. */
async function deleteRelationsTouchingEntity(payload: Payload, entityId: string): Promise<void> {
  await payload.delete({
    collection: 'catalog-relations',
    where: {
      or: [{ from: { equals: entityId } }, { to: { equals: entityId } }],
    },
    overrideAccess: true,
  })
}

/**
 * Remove a projected entity (and every relation touching it) when its source
 * row is deleted. No-op when the entity was never projected.
 */
export async function removeProjectedEntity(
  payload: Payload,
  sourceType: EntitySource['type'],
  sourceId: string,
): Promise<void> {
  const entityId = await findEntityIdBySource(payload, sourceType, sourceId)
  if (!entityId) return

  await deleteRelationsTouchingEntity(payload, entityId)
  await payload.delete({
    collection: 'catalog-entities',
    id: entityId,
    overrideAccess: true,
  })
}

/**
 * Remove every projected relation that came from a given source row (e.g. a
 * deleted kafka-lineage-edge). Keyed on relation source.type + source.sourceId.
 */
export async function removeProjectedRelationsForSource(
  payload: Payload,
  sourceType: RelationSource['type'],
  sourceId: string,
): Promise<void> {
  await payload.delete({
    collection: 'catalog-relations',
    where: {
      and: [
        { 'source.type': { equals: sourceType } },
        { 'source.sourceId': { equals: sourceId } },
      ],
    },
    overrideAccess: true,
  })
}
