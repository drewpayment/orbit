import type { Where } from 'payload'
import type { CatalogEntity } from '@/payload-types'

/**
 * Pure (server- and client-safe, React-free) query + label helpers for the
 * catalog list UI. Kept out of the `'use server'` actions file so the
 * where-builder can be unit-tested directly and the kind labels can be shared
 * by both the server page and the client list without pulling in icons.
 */

export type EntityKind = CatalogEntity['kind']

/** All catalog entity kinds, in display order. Mirrors ENTITY_KINDS on the collection. */
export const ENTITY_KIND_VALUES = [
  'service',
  'api',
  'resource',
  'datastore',
  'kafka-topic',
  'domain',
  'system',
  'team',
  'environment',
] as const

/** Human-friendly, pluralised labels used for the kind tabs. */
export const KIND_LABELS: Record<EntityKind, string> = {
  service: 'Services',
  api: 'APIs',
  resource: 'Resources',
  datastore: 'Datastores',
  'kafka-topic': 'Topics',
  domain: 'Domains',
  system: 'Systems',
  team: 'Teams',
  environment: 'Environments',
}

/** Singular labels for badges / detail contexts. */
export const KIND_LABELS_SINGULAR: Record<EntityKind, string> = {
  service: 'Service',
  api: 'API',
  resource: 'Resource',
  datastore: 'Datastore',
  'kafka-topic': 'Kafka Topic',
  domain: 'Domain',
  system: 'System',
  team: 'Team',
  environment: 'Environment',
}

/** Narrow an arbitrary string (e.g. a URL search param) to a valid kind. */
export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && (ENTITY_KIND_VALUES as readonly string[]).includes(value)
}

export interface CatalogWhereInput {
  /** Workspace IDs the current user may read. An empty array yields a match-nothing clause. */
  workspaceIds: string[]
  /** Restrict to a single entity kind. */
  kind?: EntityKind
  /** Free-text query matched against name and description. */
  query?: string
}

/**
 * Build the Payload `Where` clause for a workspace-scoped catalog query.
 *
 * Access is enforced by always constraining `workspace` to the caller's
 * memberships (we call `find` with `overrideAccess: true`, so this clause IS
 * the tenant boundary). An empty `workspaceIds` deliberately produces a clause
 * that matches nothing rather than leaking every workspace's entities.
 */
export function buildCatalogWhere({ workspaceIds, kind, query }: CatalogWhereInput): Where {
  const conditions: Where[] = [{ workspace: { in: workspaceIds.length > 0 ? workspaceIds : ['__none__'] } }]

  if (kind) {
    conditions.push({ kind: { equals: kind } })
  }

  const trimmed = query?.trim()
  if (trimmed) {
    conditions.push({
      or: [{ name: { contains: trimmed } }, { description: { contains: trimmed } }],
    })
  }

  return conditions.length > 1 ? { and: conditions } : conditions[0]
}
