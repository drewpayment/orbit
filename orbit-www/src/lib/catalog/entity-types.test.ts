import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'
import type { EntityType } from '@/payload-types'
import { ENTITY_KINDS } from '@/collections/catalog/constants'
import {
  DEFAULT_ENTITY_TYPE,
  mergeEntityType,
  resolveEntityType,
  listEntityTypes,
} from './entity-types'

/** Build a minimal EntityType row; only the fields the merge reads need to be real. */
function entityTypeRow(partial: Partial<EntityType> = {}): EntityType {
  return {
    id: partial.id ?? 'et1',
    workspace: partial.workspace ?? 'ws1',
    kind: partial.kind ?? 'service',
    displayName: partial.displayName ?? 'Backend Service',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as EntityType
}

/** A hand-rolled mock of the payload local API surface: `find` returns `docs`. */
function makePayload(docs: EntityType[]) {
  const find = vi.fn(async () => ({ docs }))
  const payload = { find } as unknown as Payload
  return { payload, find }
}

// --- mergeEntityType (pure) --------------------------------------------------

describe('mergeEntityType', () => {
  it('no stored row -> the built-in default, with kind/displayName filled from `kind`', () => {
    const def = mergeEntityType(null, 'service')
    expect(def).toEqual({
      kind: 'service',
      displayName: 'service',
      description: null,
      baseValue: 50,
      scoringWeight: 1,
      goldenPath: { summary: null, docsUrl: null, requiredRelations: [], requiredMetadata: [] },
    })
  })

  it('undefined row behaves the same as null', () => {
    expect(mergeEntityType(undefined, 'api')).toEqual(mergeEntityType(null, 'api'))
  })

  it('a full stored row overrides every default field', () => {
    const row = entityTypeRow({
      kind: 'service',
      displayName: 'Backend Service',
      description: 'Long-running backend processes.',
      baseValue: 70,
      scoringWeight: 2,
      goldenPath: {
        summary: 'Deploy via the platform template.',
        docsUrl: 'https://docs.example.com/paved-road/service',
        requiredRelations: [
          { relationType: 'owns', direction: 'from', targetKind: 'team', min: 1 },
        ],
        requiredMetadata: [{ path: 'metadata.costCenter', label: 'Cost center' }],
      },
    })

    const def = mergeEntityType(row, 'service')
    expect(def).toEqual({
      kind: 'service',
      displayName: 'Backend Service',
      description: 'Long-running backend processes.',
      baseValue: 70,
      scoringWeight: 2,
      goldenPath: {
        summary: 'Deploy via the platform template.',
        docsUrl: 'https://docs.example.com/paved-road/service',
        requiredRelations: [
          { relationType: 'owns', direction: 'from', targetKind: 'team', min: 1 },
        ],
        requiredMetadata: [{ path: 'metadata.costCenter', label: 'Cost center' }],
      },
    })
  })

  it('a partial stored row falls back per-field to the default (not a wholesale replace)', () => {
    // Only displayName + baseValue set; scoringWeight, description, and
    // goldenPath.* are absent on the row and must fall back independently.
    const row = entityTypeRow({ kind: 'api', displayName: 'Public API', baseValue: 80 })

    const def = mergeEntityType(row, 'api')
    expect(def).toEqual({
      kind: 'api',
      displayName: 'Public API',
      description: null,
      baseValue: 80,
      scoringWeight: 1,
      goldenPath: { summary: null, docsUrl: null, requiredRelations: [], requiredMetadata: [] },
    })
  })

  it('baseValue of 0 is respected, not treated as missing (nullish coalescing, not ||)', () => {
    const row = entityTypeRow({ baseValue: 0 })
    expect(mergeEntityType(row, 'service').baseValue).toBe(0)
  })

  it('an empty displayName on the row falls back to the kind (falsy-string guard)', () => {
    const row = entityTypeRow({ displayName: '' })
    expect(mergeEntityType(row, 'service').displayName).toBe('service')
  })

  it('goldenPath.requiredRelations entries default direction and min when unset', () => {
    const row = entityTypeRow({
      goldenPath: {
        requiredRelations: [{ relationType: 'depends-on' }],
        requiredMetadata: [],
      } as unknown as EntityType['goldenPath'],
    })
    const def = mergeEntityType(row, 'service')
    expect(def.goldenPath.requiredRelations).toEqual([
      { relationType: 'depends-on', direction: 'either', targetKind: null, min: 1 },
    ])
  })

  it('goldenPath.requiredMetadata entries default label to null when unset', () => {
    const row = entityTypeRow({
      goldenPath: {
        requiredRelations: [],
        requiredMetadata: [{ path: 'metadata.tier' }],
      } as unknown as EntityType['goldenPath'],
    })
    const def = mergeEntityType(row, 'service')
    expect(def.goldenPath.requiredMetadata).toEqual([{ path: 'metadata.tier', label: null }])
  })

  it('DEFAULT_ENTITY_TYPE matches the plan literals (baseValue 50, scoringWeight 1)', () => {
    expect(DEFAULT_ENTITY_TYPE.baseValue).toBe(50)
    expect(DEFAULT_ENTITY_TYPE.scoringWeight).toBe(1)
    expect(DEFAULT_ENTITY_TYPE.goldenPath).toEqual({
      summary: null,
      docsUrl: null,
      requiredRelations: [],
      requiredMetadata: [],
    })
  })
})

// --- resolveEntityType (async wrapper) --------------------------------------

describe('resolveEntityType', () => {
  it('queries entity-types scoped to (workspace, kind) and merges the found row', async () => {
    const row = entityTypeRow({ kind: 'datastore', displayName: 'Datastore', baseValue: 60 })
    const { payload, find } = makePayload([row])

    const def = await resolveEntityType(payload, 'ws1', 'datastore')

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'entity-types',
        where: { and: [{ workspace: { equals: 'ws1' } }, { kind: { equals: 'datastore' } }] },
        overrideAccess: true,
      }),
    )
    expect(def.displayName).toBe('Datastore')
    expect(def.baseValue).toBe(60)
  })

  it('no matching row -> the built-in default for that kind', async () => {
    const { payload } = makePayload([])
    const def = await resolveEntityType(payload, 'ws1', 'team')
    expect(def).toEqual(mergeEntityType(null, 'team'))
  })
})

// --- listEntityTypes (async wrapper) ----------------------------------------

describe('listEntityTypes', () => {
  it('returns exactly one definition per ENTITY_KINDS entry', async () => {
    const { payload } = makePayload([])
    const defs = await listEntityTypes(payload, 'ws1')
    expect(defs.map((d) => d.kind)).toEqual([...ENTITY_KINDS])
  })

  it('merges stored rows over defaults for the kinds that have one, defaults for the rest', async () => {
    const rows = [
      entityTypeRow({ kind: 'service', displayName: 'Backend Service', baseValue: 65 }),
      entityTypeRow({ kind: 'team', displayName: 'Team', baseValue: 100 }),
    ]
    const { payload, find } = makePayload(rows)

    const defs = await listEntityTypes(payload, 'ws1')

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'entity-types',
        where: { workspace: { equals: 'ws1' } },
        overrideAccess: true,
      }),
    )

    const byKind = new Map(defs.map((d) => [d.kind, d]))
    expect(byKind.get('service')?.baseValue).toBe(65)
    expect(byKind.get('team')?.baseValue).toBe(100)
    // A kind with no stored row still gets the pure default.
    expect(byKind.get('api')).toEqual(mergeEntityType(null, 'api'))
  })
})
