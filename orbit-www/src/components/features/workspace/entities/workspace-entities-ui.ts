/**
 * Pure presentation helpers for the workspace landpage Entities card
 * (Catalog Entity CRUD, WP3 — docs/plans/2026-07-02-catalog-entity-crud.md).
 *
 * Framework-light on purpose (mirrors scorecards/initiatives' `*-ui.ts`
 * convention): no 'use server', no React, no Payload imports, so the
 * component can stay a server component and this module can be unit-tested
 * directly. Kind labels are kept LOCAL to this file rather than imported from
 * `components/features/catalog/**` — that package is owned by a different
 * work package landing in parallel on the same branch; duplicating a small
 * label map avoids a cross-agent coupling point (same rationale as
 * `catalog/entity-kind-meta.ts`'s "self-contained" comment).
 */

import type { CatalogEntity } from '@/payload-types'

export type EntityKind = CatalogEntity['kind']

/** Human-friendly, pluralised labels — mirrors catalog-query.ts KIND_LABELS values. */
export const KIND_LABELS: Record<EntityKind, string> = {
  service: 'Services',
  api: 'APIs',
  resource: 'Resources',
  datastore: 'Datastores',
  'kafka-topic': 'Kafka Topics',
  domain: 'Domains',
  system: 'Systems',
  team: 'Teams',
  environment: 'Environments',
}

/** Minimal shape the card needs per entity — deliberately plain, not the full CatalogEntity. */
export interface WorkspaceEntitySummary {
  id: string
  name: string
  kind: EntityKind
}

export interface EntityKindGroup {
  kind: EntityKind
  label: string
  count: number
  /** Up to `maxPerKind` entities, alphabetical by name. */
  topEntities: WorkspaceEntitySummary[]
}

const DEFAULT_MAX_PER_KIND = 5

/**
 * Group a workspace's entities by kind, each group carrying its full count
 * plus a capped, alphabetised preview list. Groups are ordered by count
 * (largest first), ties broken alphabetically by label, so the card leads
 * with the workspace's most substantial kind.
 */
export function groupEntitiesByKind(
  entities: WorkspaceEntitySummary[],
  maxPerKind: number = DEFAULT_MAX_PER_KIND,
): EntityKindGroup[] {
  const byKind = new Map<EntityKind, WorkspaceEntitySummary[]>()
  for (const entity of entities) {
    const list = byKind.get(entity.kind)
    if (list) {
      list.push(entity)
    } else {
      byKind.set(entity.kind, [entity])
    }
  }

  const groups: EntityKindGroup[] = []
  for (const [kind, list] of byKind) {
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
    groups.push({
      kind,
      label: KIND_LABELS[kind] ?? kind,
      count: list.length,
      topEntities: sorted.slice(0, maxPerKind),
    })
  }

  return groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Sum of all group counts — the card's total-entities badge. */
export function totalEntityCount(groups: EntityKindGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0)
}

/** True when the workspace already has a `team`-kind entity (the "Create team" callout gate). */
export function hasTeamEntity(entities: Pick<WorkspaceEntitySummary, 'kind'>[]): boolean {
  return entities.some((entity) => entity.kind === 'team')
}

/** Detail-page link for one entity. */
export function catalogEntityHref(id: string): string {
  return `/catalog/${id}`
}

/**
 * "New entity" link, preselecting this workspace. Points at `/catalog/new`
 * (owned by the WP2 catalog-UI work package landing in parallel) with a
 * `workspace` query param for prefill; falls back gracefully to the bare
 * create page if that param isn't wired up yet.
 */
export function catalogNewEntityHref(workspaceId: string): string {
  return `/catalog/new?workspace=${encodeURIComponent(workspaceId)}`
}

/** "Create team" link — same create page, preset to kind=team. */
export function catalogNewTeamHref(workspaceId: string): string {
  return `/catalog/new?workspace=${encodeURIComponent(workspaceId)}&kind=team`
}

/**
 * "View all in catalog" link, pre-filtered to this workspace via the catalog
 * list's `?workspace=<id>` param (core-dev + catalog-ui-dev added org-wide
 * read + a real workspace filter — see
 * docs/plans/2026-07-02-catalog-entity-crud.md's read-path-changes note).
 */
export function catalogViewAllHref(workspaceId: string): string {
  return `/catalog?workspace=${encodeURIComponent(workspaceId)}`
}
