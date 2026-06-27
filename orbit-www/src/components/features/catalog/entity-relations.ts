import type { CatalogEntity, CatalogRelation } from '@/payload-types'

/**
 * Pure helpers for shaping catalog relations around a focal entity.
 *
 * Relations are directed edges `from --(type)--> to`. From the perspective of a
 * focal entity, an edge is OUTBOUND when the entity is `from` and INBOUND when
 * it is `to`. These helpers normalize a depth-1 relation list (where `from`/`to`
 * are populated CatalogEntity objects) into per-neighbour edges grouped by type.
 *
 * Kept dependency-free and JSX-free so the detail UI and the graph can share
 * them and so they're unit-testable in isolation.
 */

export const RELATION_TYPES = [
  'owns',
  'depends-on',
  'exposes-api',
  'consumes-api',
  'produces-topic',
  'consumes-topic',
  'runs-in',
  'built-from',
  'part-of',
] as const

export type RelationType = (typeof RELATION_TYPES)[number]

export type RelationDirection = 'outbound' | 'inbound'

/** A single edge resolved from the focal entity to one neighbour. */
export interface RelationEdge {
  /** The underlying relation id. */
  id: string
  type: RelationType
  direction: RelationDirection
  /** The entity on the other end of the edge (never the focal entity). */
  neighbor: CatalogEntity
}

/** Edges sharing a relation type, in a stable display order. */
export interface RelationGroup {
  type: RelationType
  direction: RelationDirection
  edges: RelationEdge[]
}

function entityId(ref: string | CatalogEntity | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

function populatedEntity(ref: string | CatalogEntity | null | undefined): CatalogEntity | null {
  return ref && typeof ref === 'object' ? ref : null
}

/**
 * Resolve a relation list into per-neighbour edges relative to `focalId`.
 * Edges whose neighbour is not populated (depth too shallow) or that are
 * self-loops are dropped so the UI never renders a dangling node.
 */
export function toEdges(relations: CatalogRelation[], focalId: string): RelationEdge[] {
  const edges: RelationEdge[] = []
  for (const rel of relations) {
    const fromId = entityId(rel.from)
    const toId = entityId(rel.to)

    let direction: RelationDirection
    let neighborRef: string | CatalogEntity | null | undefined
    if (fromId === focalId) {
      direction = 'outbound'
      neighborRef = rel.to
    } else if (toId === focalId) {
      direction = 'inbound'
      neighborRef = rel.from
    } else {
      // Relation doesn't touch the focal entity — ignore defensively.
      continue
    }

    const neighbor = populatedEntity(neighborRef)
    if (!neighbor || neighbor.id === focalId) continue

    edges.push({ id: rel.id, type: rel.type, direction, neighbor })
  }
  return edges
}

/** Split edges into outbound/inbound buckets. */
export function splitEdges(edges: RelationEdge[]): {
  outbound: RelationEdge[]
  inbound: RelationEdge[]
} {
  return {
    outbound: edges.filter((e) => e.direction === 'outbound'),
    inbound: edges.filter((e) => e.direction === 'inbound'),
  }
}

/**
 * Group edges by relation type, preserving the canonical RELATION_TYPES order
 * and splitting each type into its outbound and inbound halves (a type can
 * appear in both directions, e.g. `depends-on` up and downstream).
 */
export function groupEdgesByType(edges: RelationEdge[]): RelationGroup[] {
  const groups: RelationGroup[] = []
  for (const type of RELATION_TYPES) {
    for (const direction of ['outbound', 'inbound'] as const) {
      const matching = edges.filter((e) => e.type === type && e.direction === direction)
      if (matching.length > 0) {
        groups.push({ type, direction, edges: matching })
      }
    }
  }
  return groups
}

/** Human-friendly label for a relation type (e.g. `depends-on` → `Depends on`). */
export function relationTypeLabel(type: RelationType): string {
  const words = type.split('-')
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}
