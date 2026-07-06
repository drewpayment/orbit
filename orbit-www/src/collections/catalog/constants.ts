/**
 * Framework-light catalog vocabularies (IDP refocus P1).
 *
 * These enums live APART from the Payload collection configs
 * (CatalogEntities/CatalogRelations) on purpose: client-reachable modules — e.g.
 * the scorecards `rule-builder`, which is imported by the client RuleBuilder —
 * need the kind/relation vocabularies WITHOUT dragging the collection configs
 * (and their server-only `afterChange` hook dependencies) into the browser
 * bundle. Import the constants from HERE, never from the collection files or the
 * `@/collections/catalog` barrel, in any code that can run on the client.
 *
 * Pure data — no Payload, React, or `server-only` imports.
 */

export const ENTITY_KINDS = [
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

export type EntityKind = (typeof ENTITY_KINDS)[number]
export type RelationType = (typeof RELATION_TYPES)[number]
