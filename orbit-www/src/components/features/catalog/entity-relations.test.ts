import { describe, it, expect } from 'vitest'
import type { CatalogEntity, CatalogRelation } from '@/payload-types'
import {
  toEdges,
  splitEdges,
  groupEdgesByType,
  relationTypeLabel,
} from './entity-relations'

function entity(id: string, name = id): CatalogEntity {
  return {
    id,
    name,
    kind: 'service',
    workspace: 'ws1',
    source: { type: 'manual' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function relation(
  id: string,
  from: string | CatalogEntity,
  to: string | CatalogEntity,
  type: CatalogRelation['type'],
): CatalogRelation {
  return {
    id,
    workspace: 'ws1',
    from,
    to,
    type,
    source: { type: 'manual' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const focal = entity('focal')
const teamA = entity('team-a', 'Team A')
const svcB = entity('svc-b', 'Service B')
const svcC = entity('svc-c', 'Service C')

describe('toEdges', () => {
  it('classifies edges as outbound when the focal entity is `from`', () => {
    const rels = [relation('r1', focal, svcB, 'depends-on')]
    const edges = toEdges(rels, focal.id)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      id: 'r1',
      type: 'depends-on',
      direction: 'outbound',
    })
    expect(edges[0].neighbor.id).toBe('svc-b')
  })

  it('classifies edges as inbound when the focal entity is `to`', () => {
    const rels = [relation('r1', teamA, focal, 'owns')]
    const edges = toEdges(rels, focal.id)
    expect(edges[0].direction).toBe('inbound')
    expect(edges[0].neighbor.id).toBe('team-a')
  })

  it('drops edges whose neighbour is not populated (depth too shallow)', () => {
    const rels = [relation('r1', focal.id, 'svc-b', 'depends-on')]
    expect(toEdges(rels, focal.id)).toHaveLength(0)
  })

  it('drops self-loops and relations that do not touch the focal entity', () => {
    const rels = [
      relation('self', focal, focal, 'part-of'),
      relation('other', svcB, svcC, 'depends-on'),
    ]
    expect(toEdges(rels, focal.id)).toHaveLength(0)
  })
})

describe('splitEdges', () => {
  it('partitions edges into outbound and inbound buckets', () => {
    const edges = toEdges(
      [
        relation('r1', focal, svcB, 'depends-on'),
        relation('r2', teamA, focal, 'owns'),
      ],
      focal.id,
    )
    const { outbound, inbound } = splitEdges(edges)
    expect(outbound.map((e) => e.id)).toEqual(['r1'])
    expect(inbound.map((e) => e.id)).toEqual(['r2'])
  })
})

describe('groupEdgesByType', () => {
  it('groups by type and direction in canonical order', () => {
    const edges = toEdges(
      [
        relation('r1', teamA, focal, 'owns'),
        relation('r2', focal, svcB, 'depends-on'),
        relation('r3', focal, svcC, 'depends-on'),
      ],
      focal.id,
    )
    const groups = groupEdgesByType(edges)
    // `owns` precedes `depends-on` in RELATION_TYPES order.
    expect(groups.map((g) => g.type)).toEqual(['owns', 'depends-on'])
    expect(groups[0]).toMatchObject({ type: 'owns', direction: 'inbound' })
    expect(groups[1]).toMatchObject({ type: 'depends-on', direction: 'outbound' })
    expect(groups[1].edges.map((e) => e.neighbor.id)).toEqual(['svc-b', 'svc-c'])
  })

  it('splits a single type appearing in both directions', () => {
    const edges = toEdges(
      [
        relation('out', focal, svcB, 'depends-on'),
        relation('in', svcC, focal, 'depends-on'),
      ],
      focal.id,
    )
    const groups = groupEdgesByType(edges)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.direction)).toEqual(['outbound', 'inbound'])
  })
})

describe('relationTypeLabel', () => {
  it('humanizes hyphenated relation types', () => {
    expect(relationTypeLabel('depends-on')).toBe('Depends on')
    expect(relationTypeLabel('exposes-api')).toBe('Exposes api')
    expect(relationTypeLabel('owns')).toBe('Owns')
  })
})
