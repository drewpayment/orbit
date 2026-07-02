import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import {
  slugify,
  mergeProjectionUpdate,
  projectAppEntity,
  projectApiSchemaEntity,
  projectKafkaTopicEntity,
  projectKafkaLineageRelation,
  removeProjectedEntity,
  removeProjectedRelationsForSource,
} from './projection'
import type { App, ApiSchema, KafkaTopic, KafkaLineageEdge } from '@/payload-types'

/**
 * A hand-rolled mock of the payload local API surface used by the projection
 * layer. `findResults` is a queue of `{ docs }` payloads returned by successive
 * `find` calls, letting a test script the "exists / does-not-exist" branches.
 */
function makePayload(opts?: {
  findResults?: { docs: { id: string }[] }[]
  findByID?: (args: { collection: string; id: string }) => unknown
}) {
  const findResults = [...(opts?.findResults ?? [])]
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const find = vi.fn(async (..._args: any[]) => findResults.shift() ?? { docs: [] })
  const create = vi.fn(async ({ data }: any) => ({ id: 'new-id', ...data }))
  const update = vi.fn(async ({ id, data }: any) => ({ id, ...data }))
  const del = vi.fn(async (..._args: any[]) => ({}))
  const findByID = vi.fn(async (args: { collection: string; id: string }) =>
    opts?.findByID ? opts.findByID(args) : { id: args.id },
  )
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const payload = { find, create, update, delete: del, findByID } as unknown as Payload
  return { payload, find, create, update, delete: del, findByID }
}

const baseApp: App = {
  id: 'app-1',
  name: 'Payments Service',
  description: 'Handles payments',
  workspace: 'ws-1',
  status: 'degraded',
  repository: { url: 'https://github.com/acme/payments' },
  buildConfig: { language: 'go', framework: 'gin' },
  latestBuild: { status: 'success', imageTag: 'v1.2.3', builtAt: '2026-06-01T00:00:00.000Z' },
  updatedAt: '2026-06-01T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
} as unknown as App

describe('slugify', () => {
  it.each([
    ['Payments Service', 'payments-service'],
    ['  Trim  Me  ', 'trim-me'],
    ['Already-Slug', 'already-slug'],
    ['Special!@#Chars', 'special-chars'],
    ['Café Über', 'cafe-uber'],
    ['', ''],
  ])('slugifies %j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('handles null/undefined', () => {
    expect(slugify(null)).toBe('')
    expect(slugify(undefined)).toBe('')
  })
})

describe('projectAppEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates an entity when none exists', async () => {
    const { payload, find, create, update } = makePayload({ findResults: [{ docs: [] }] })
    const id = await projectAppEntity(payload, baseApp)

    expect(find).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledOnce()
    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({
      name: 'Payments Service',
      slug: 'payments-service',
      kind: 'service',
      workspace: 'ws-1',
      health: 'degraded',
      source: { type: 'apps', sourceId: 'app-1' },
    })
    // repository link folded in
    expect(data.links).toEqual([
      { label: 'Repository', url: 'https://github.com/acme/payments', type: 'repository' },
    ])
    // build summary in metadata
    expect(data.metadata.build).toEqual({ language: 'go', framework: 'gin' })
    expect(data.metadata.latestBuild.imageTag).toBe('v1.2.3')
    expect(id).toBe('new-id')
  })

  it('updates the existing entity when one is already projected (idempotent)', async () => {
    const { payload, create, update } = makePayload({ findResults: [{ docs: [{ id: 'ent-1' }] }] })
    const id = await projectAppEntity(payload, baseApp)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][0]).toMatchObject({
      collection: 'catalog-entities',
      id: 'ent-1',
      overrideAccess: true,
    })
    // update must NOT rewrite source provenance
    expect(update.mock.calls[0][0].data.source).toBeUndefined()
    expect(id).toBe('ent-1')
  })

  it('throws when the app has no workspace', async () => {
    const { payload } = makePayload()
    await expect(
      projectAppEntity(payload, { ...baseApp, workspace: null } as unknown as App),
    ).rejects.toThrow(/workspace/)
  })
})

describe('projectApiSchemaEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  const baseSchema: ApiSchema = {
    id: 'api-1',
    name: 'Billing API',
    slug: 'billing-api',
    description: 'Billing endpoints',
    workspace: 'ws-1',
    status: 'published',
    schemaType: 'openapi',
    currentVersion: '1.0.0',
    visibility: 'workspace',
    rawContent: '',
    createdBy: 'user-1',
    updatedAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
  } as unknown as ApiSchema

  it('creates an api entity with lifecycle mapped from status', async () => {
    const { payload, create } = makePayload({ findResults: [{ docs: [] }] })
    const id = await projectApiSchemaEntity(payload, baseSchema)

    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({
      kind: 'api',
      slug: 'billing-api',
      lifecycle: 'production', // published -> production
      source: { type: 'api-schemas', sourceId: 'api-1' },
    })
    expect(id).toBe('new-id')
  })

  it('projects an exposes-api relation when the schema links to an app', async () => {
    // find #1: api entity lookup (absent) -> create
    // find #2: app entity lookup by source (present, id ent-app)
    // find #3: relation lookup (absent) -> create relation
    const { payload, create, findByID } = makePayload({
      findResults: [{ docs: [] }, { docs: [{ id: 'ent-app' }] }, { docs: [] }],
    })
    await projectApiSchemaEntity(payload, { ...baseSchema, repository: 'app-1' } as unknown as ApiSchema)

    // app entity already projected -> no findByID for apps
    expect(findByID).not.toHaveBeenCalled()
    // two creates: the api entity + the relation
    expect(create).toHaveBeenCalledTimes(2)
    const relData = create.mock.calls[1][0].data
    expect(relData).toMatchObject({
      type: 'exposes-api',
      from: 'ent-app',
      to: 'new-id',
      workspace: 'ws-1',
      source: { type: 'api-schemas', sourceId: 'api-1' },
    })
  })

  it('projects the linked app on demand when it is not in the graph yet', async () => {
    // find #1: api entity (absent) -> create api (new-id)
    // find #2: app entity by source (absent) -> findByID apps -> projectAppEntity
    // find #3: inside projectAppEntity, app entity (absent) -> create app entity (new-id)
    // find #4: relation lookup (absent) -> create relation
    const { payload, create, findByID } = makePayload({
      findResults: [{ docs: [] }, { docs: [] }, { docs: [] }, { docs: [] }],
      findByID: () => baseApp,
    })
    await projectApiSchemaEntity(payload, { ...baseSchema, repository: 'app-1' } as unknown as ApiSchema)

    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'apps', id: 'app-1' }))
    // api entity + app entity + relation
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('skips exposes-api when there is no linked app', async () => {
    const { payload, create } = makePayload({ findResults: [{ docs: [] }] })
    await projectApiSchemaEntity(payload, baseSchema)
    // only the api entity, no relation
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('projectKafkaTopicEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  const baseTopic: KafkaTopic = {
    id: 'topic-1',
    name: 'orders',
    fullTopicName: 'prod.acme.orders',
    description: 'Order events',
    workspace: 'ws-1',
    environment: 'prod',
    partitions: 6,
    status: 'active',
    visibility: 'discoverable',
    updatedAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
  } as unknown as KafkaTopic

  it('creates a kafka-topic entity with slug from fullTopicName and health from status', async () => {
    const { payload, create } = makePayload({ findResults: [{ docs: [] }] })
    await projectKafkaTopicEntity(payload, baseTopic)

    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({
      kind: 'kafka-topic',
      slug: 'prod-acme-orders',
      health: 'healthy', // active -> healthy
      source: { type: 'kafka', sourceId: 'topic-1' },
    })
    expect(data.metadata.environment).toBe('prod')
  })

  it('maps a failed topic to down health', async () => {
    const { payload, create } = makePayload({ findResults: [{ docs: [] }] })
    await projectKafkaTopicEntity(payload, { ...baseTopic, status: 'failed' } as KafkaTopic)
    expect(create.mock.calls[0][0].data.health).toBe('down')
  })
})

describe('projectKafkaLineageRelation', () => {
  beforeEach(() => vi.clearAllMocks())

  const baseEdge: KafkaLineageEdge = {
    id: 'edge-1',
    topic: 'topic-1',
    sourceApplication: 'kapp-1',
    targetWorkspace: 'ws-1',
    direction: 'produce',
    bytesAllTime: 1000,
    messagesAllTime: 50,
    isActive: true,
    isCrossWorkspace: false,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
  } as unknown as KafkaLineageEdge

  it('maps produce -> produces-topic (service -> topic) when both entities already exist', async () => {
    // find #1: topic entity by source (present, ent-topic)
    // find #2: service entity by source (present, ent-svc)
    // find #3: relation lookup (absent) -> create
    const { payload, create, findByID } = makePayload({
      findResults: [{ docs: [{ id: 'ent-topic' }] }, { docs: [{ id: 'ent-svc' }] }, { docs: [] }],
    })
    const id = await projectKafkaLineageRelation(payload, baseEdge)

    expect(findByID).not.toHaveBeenCalled()
    const relData = create.mock.calls[0][0].data
    expect(relData).toMatchObject({
      type: 'produces-topic',
      from: 'ent-svc',
      to: 'ent-topic',
      workspace: 'ws-1',
      source: { type: 'kafka-lineage', sourceId: 'edge-1' },
    })
    expect(relData.metadata.direction).toBe('produce')
    expect(id).toBe('new-id')
  })

  it('maps consume -> consumes-topic', async () => {
    const { payload, create } = makePayload({
      findResults: [{ docs: [{ id: 'ent-topic' }] }, { docs: [{ id: 'ent-svc' }] }, { docs: [] }],
    })
    await projectKafkaLineageRelation(payload, { ...baseEdge, direction: 'consume' } as KafkaLineageEdge)
    expect(create.mock.calls[0][0].data.type).toBe('consumes-topic')
  })

  it('skips (returns null) when the edge has no topic', async () => {
    const { payload, create } = makePayload()
    const id = await projectKafkaLineageRelation(
      payload,
      { ...baseEdge, topic: null } as unknown as KafkaLineageEdge,
    )
    expect(id).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('projects the topic and service on demand when absent', async () => {
    // find #1: topic entity (absent) -> findByID kafka-topics -> project
    // find #2: inside projectKafkaTopicEntity (absent) -> create topic entity
    // find #3: service entity (absent) -> findByID kafka-applications -> project
    // find #4: inside projectKafkaApplicationEntity (absent) -> create service entity
    // find #5: relation lookup (absent) -> create relation
    const { payload, create, findByID } = makePayload({
      findResults: [{ docs: [] }, { docs: [] }, { docs: [] }, { docs: [] }, { docs: [] }],
      findByID: (args) =>
        args.collection === 'kafka-topics'
          ? { id: 'topic-1', name: 'orders', workspace: 'ws-1', status: 'active' }
          : { id: 'kapp-1', name: 'Producer App', workspace: 'ws-1' },
    })
    const id = await projectKafkaLineageRelation(payload, baseEdge)
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'kafka-topics' }))
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'kafka-applications' }),
    )
    // topic entity + service entity + relation
    expect(create).toHaveBeenCalledTimes(3)
    expect(id).toBe('new-id')
  })
})

describe('removeProjectedEntity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes touching relations and the entity when projected', async () => {
    const { payload, delete: del } = makePayload({ findResults: [{ docs: [{ id: 'ent-1' }] }] })
    await removeProjectedEntity(payload, 'apps', 'app-1')

    expect(del).toHaveBeenCalledTimes(2)
    // first delete: relations touching the entity (by where)
    expect(del.mock.calls[0][0]).toMatchObject({ collection: 'catalog-relations' })
    expect(del.mock.calls[0][0].where).toEqual({
      or: [{ from: { equals: 'ent-1' } }, { to: { equals: 'ent-1' } }],
    })
    // second delete: the entity itself (by id)
    expect(del.mock.calls[1][0]).toMatchObject({ collection: 'catalog-entities', id: 'ent-1' })
  })

  it('is a no-op when nothing was projected', async () => {
    const { payload, delete: del } = makePayload({ findResults: [{ docs: [] }] })
    await removeProjectedEntity(payload, 'apps', 'missing')
    expect(del).not.toHaveBeenCalled()
  })
})

describe('removeProjectedRelationsForSource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes relations matching the source provenance', async () => {
    const { payload, delete: del } = makePayload()
    await removeProjectedRelationsForSource(payload, 'kafka-lineage', 'edge-1')
    expect(del).toHaveBeenCalledOnce()
    expect(del.mock.calls[0][0]).toMatchObject({ collection: 'catalog-relations' })
    expect(del.mock.calls[0][0].where).toEqual({
      and: [
        { 'source.type': { equals: 'kafka-lineage' } },
        { 'source.sourceId': { equals: 'edge-1' } },
      ],
    })
  })
})


describe('mergeProjectionUpdate (field-ownership / set-if-absent)', () => {
  const incoming = {
    name: 'Payments Service',
    slug: 'payments-service',
    kind: 'service' as const,
    workspace: 'ws-1',
    description: 'Auto description from source',
    health: 'healthy' as const,
    lifecycle: 'production' as const,
    links: [{ label: 'Repository', url: 'https://github.com/acme/payments' }],
    metadata: { build: { language: 'go' } },
  }

  it('always writes projection-owned identity fields (name/slug/kind/workspace/health)', () => {
    const out = mergeProjectionUpdate({ description: 'Human edited' }, incoming)
    expect(out).toMatchObject({
      name: 'Payments Service',
      slug: 'payments-service',
      kind: 'service',
      workspace: 'ws-1',
      health: 'healthy',
    })
  })

  it('preserves a human-entered description/links/metadata (does not write them)', () => {
    const out = mergeProjectionUpdate(
      {
        description: 'Human edited',
        links: [{ label: 'Runbook', url: 'https://rb' }],
        metadata: { note: 'kept' },
      },
      incoming,
    )
    expect(out.description).toBeUndefined()
    expect(out.links).toBeUndefined()
    expect(out.metadata).toBeUndefined()
  })

  it('fills curation fields when the existing value is empty/absent', () => {
    const out = mergeProjectionUpdate(
      { description: '', links: [], metadata: {} },
      incoming,
    )
    expect(out.description).toBe('Auto description from source')
    expect(out.lifecycle).toBe('production')
    expect(out.links).toEqual(incoming.links)
    expect(out.metadata).toEqual(incoming.metadata)
  })

  it('never emits a source key (provenance is create-only)', () => {
    const out = mergeProjectionUpdate({}, incoming)
    expect('source' in out).toBe(false)
  })
})
