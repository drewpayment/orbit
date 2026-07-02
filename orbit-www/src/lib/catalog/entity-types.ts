import type { Payload } from 'payload'
import type { EntityType } from '@/payload-types'
import { ENTITY_KINDS, type EntityKind } from '@/collections/catalog/constants'

/**
 * Entity type resolver (Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * `entity-types` rows are OPTIONAL customizations: a workspace only needs to
 * create one when it wants to override the defaults or define a golden path.
 * `resolveEntityType`/`listEntityTypes` merge a stored row (if any) over the
 * built-in default so scoring (lib/scorecards/scoring.ts) always has a
 * definition to read, never blocking on setup.
 *
 * The merge itself (`mergeEntityType`) is pure and exported for unit testing
 * without mocking Payload; the `resolve*`/`list*` functions are the thin
 * async wrappers that query `entity-types` and hand off to it.
 */

export interface RequiredRelationExpectation {
  relationType: string
  direction: 'from' | 'to' | 'either'
  targetKind: EntityKind | null
  min: number
}

export interface RequiredMetadataExpectation {
  path: string
  label: string | null
}

export interface EntityTypeDefinition {
  kind: EntityKind
  displayName: string
  description: string | null
  baseValue: number
  scoringWeight: number
  goldenPath: {
    summary: string | null
    docsUrl: string | null
    requiredRelations: RequiredRelationExpectation[]
    requiredMetadata: RequiredMetadataExpectation[]
  }
}

/**
 * Built-in fallback values used when no `entity-types` row exists (or a row
 * exists but leaves a field unset) for a (workspace, kind). `kind` and
 * `displayName` are supplied per-call since they vary; everything else here
 * is the literal default from the plan (baseValue 50, scoringWeight 1, empty
 * golden path).
 */
export const DEFAULT_ENTITY_TYPE: Omit<EntityTypeDefinition, 'kind' | 'displayName'> = {
  description: null,
  baseValue: 50,
  scoringWeight: 1,
  goldenPath: {
    summary: null,
    docsUrl: null,
    requiredRelations: [],
    requiredMetadata: [],
  },
}

/** The default definition for `kind` absent any stored customization. */
function defaultDefinitionFor(kind: EntityKind): EntityTypeDefinition {
  return {
    kind,
    displayName: kind,
    description: DEFAULT_ENTITY_TYPE.description,
    baseValue: DEFAULT_ENTITY_TYPE.baseValue,
    scoringWeight: DEFAULT_ENTITY_TYPE.scoringWeight,
    goldenPath: {
      summary: DEFAULT_ENTITY_TYPE.goldenPath.summary,
      docsUrl: DEFAULT_ENTITY_TYPE.goldenPath.docsUrl,
      requiredRelations: [],
      requiredMetadata: [],
    },
  }
}

/**
 * Pure merge: a stored `entity-types` row (or null/undefined when none
 * exists) merged over the built-in default for `kind`. Every optional field
 * on the row falls back to the default independently — a row that only sets
 * `displayName` still yields `baseValue: 50`, etc.
 */
export function mergeEntityType(row: EntityType | null | undefined, kind: EntityKind): EntityTypeDefinition {
  const base = defaultDefinitionFor(kind)
  if (!row) return base

  return {
    kind,
    displayName: row.displayName || base.displayName,
    description: row.description ?? base.description,
    baseValue: row.baseValue ?? base.baseValue,
    scoringWeight: row.scoringWeight ?? base.scoringWeight,
    goldenPath: {
      summary: row.goldenPath?.summary ?? base.goldenPath.summary,
      docsUrl: row.goldenPath?.docsUrl ?? base.goldenPath.docsUrl,
      requiredRelations: (row.goldenPath?.requiredRelations ?? []).map((r) => ({
        relationType: r.relationType,
        direction: r.direction ?? 'either',
        targetKind: (r.targetKind as EntityKind | null | undefined) ?? null,
        min: r.min ?? 1,
      })),
      requiredMetadata: (row.goldenPath?.requiredMetadata ?? []).map((m) => ({
        path: m.path,
        label: m.label ?? null,
      })),
    },
  }
}

/** Resolve the entity type definition for (workspace, kind), lazily defaulting. */
export async function resolveEntityType(
  payload: Payload,
  workspaceId: string,
  kind: EntityKind,
): Promise<EntityTypeDefinition> {
  const res = await payload.find({
    collection: 'entity-types',
    where: { and: [{ workspace: { equals: workspaceId } }, { kind: { equals: kind } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return mergeEntityType((res.docs[0] as EntityType | undefined) ?? null, kind)
}

/**
 * Resolve a definition for EVERY kind in `ENTITY_KINDS` for a workspace
 * (stored rows merged over defaults; kinds with no stored row get the pure
 * default). One `find` covers the whole workspace.
 */
export async function listEntityTypes(payload: Payload, workspaceId: string): Promise<EntityTypeDefinition[]> {
  const res = await payload.find({
    collection: 'entity-types',
    where: { workspace: { equals: workspaceId } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const rows = res.docs as EntityType[]
  const byKind = new Map(rows.map((row) => [row.kind, row]))
  return ENTITY_KINDS.map((kind) => mergeEntityType(byKind.get(kind), kind))
}
