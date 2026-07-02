/**
 * Pure builders + validators for the entity-type definition form (Entity Scores &
 * Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * The types-home editor (`EntityTypeForm.tsx`) collects a `kind`'s definition —
 * display metadata, the inherited `baseValue`/`scoringWeight`, and the golden
 * path's structural expectations (`requiredRelations`/`requiredMetadata`) — as
 * plain string-backed form state (inputs are always strings; numbers are parsed
 * here, not in the DOM). This module ASSEMBLES that form state into the
 * `saveEntityType` server-action payload and VALIDATES it, mirroring how
 * `scorecards/rule-builder.ts` separates pure expression building/validation
 * from its React form. Deliberately framework-light: no 'use client'/'use
 * server', no React, no Payload imports — so both the client form and the
 * server action import these and the round-trip stays unit-testable (see
 * EntityTypeFormLogic.test.ts).
 */

// Import the vocabularies from the framework-light constants module (not the
// `@/collections/catalog` barrel or a collection config) so this stays safe to
// import from the client form — mirrors the same guidance in rule-builder.ts.
import { ENTITY_KINDS, RELATION_TYPES, type EntityKind, type RelationType } from '@/collections/catalog/constants'

export type RelationDirection = 'from' | 'to' | 'either'

/** One row of the golden path's required-relations editor (string-backed). */
export interface RequiredRelationRow {
  relationType: string
  direction: RelationDirection
  /** Empty string = "any kind". */
  targetKind: string
  /** Kept as a string so the input can be blank mid-edit; parsed on save. */
  min: string
}

/** One row of the golden path's required-metadata editor (string-backed). */
export interface RequiredMetadataRow {
  path: string
  label: string
}

export interface GoldenPathFormState {
  summary: string
  docsUrl: string
  requiredRelations: RequiredRelationRow[]
  requiredMetadata: RequiredMetadataRow[]
}

/** The whole editable form, every numeric field kept as a string until save. */
export interface EntityTypeFormState {
  displayName: string
  description: string
  baseValue: string
  scoringWeight: string
  goldenPath: GoldenPathFormState
}

/** Sanitised required-relation expectation, matching `EntityTypes.goldenPath.requiredRelations`. */
export interface RequiredRelationInput {
  relationType: RelationType
  direction: RelationDirection
  targetKind: EntityKind | null
  min: number
}

/** Sanitised required-metadata expectation, matching `EntityTypes.goldenPath.requiredMetadata`. */
export interface RequiredMetadataInput {
  path: string
  label: string | null
}

/** The `saveEntityType` server-action payload — one row for (workspace, kind). */
export interface SaveEntityTypeInput {
  kind: string
  displayName: string
  description: string | null
  baseValue: number
  scoringWeight: number
  goldenPath: {
    summary: string | null
    docsUrl: string | null
    requiredRelations: RequiredRelationInput[]
    requiredMetadata: RequiredMetadataInput[]
  }
}

const DEFAULT_MIN = 1

function isEntityKindValue(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value)
}

function isRelationTypeValue(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value)
}

/** Trim `raw` and narrow it to a known {@link EntityKind}, or `null` ("any kind"). */
function narrowTargetKind(raw: string): EntityKind | null {
  const trimmed = raw.trim()
  return isEntityKindValue(trimmed) ? trimmed : null
}

/** Clamp `raw` into `[min, max]`, falling back to `fallback` when not finite. */
export function clampNumber(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

/**
 * Parse a string-backed numeric input, treating a blank (whitespace-only)
 * string as "unset" (→ `fallback`) rather than `Number('') === 0`. A
 * non-numeric string also falls back; an explicit `"0"` is preserved.
 */
function parseNumberOrFallback(raw: string, fallback: number): number {
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : fallback
}

/** Parse a form's string-backed base value into a clamped 0–100 integer. */
export function parseBaseValue(raw: string): number {
  return Math.round(clampNumber(parseNumberOrFallback(raw, 50), 0, 100, 50))
}

/** Parse a form's string-backed scoring weight into a non-negative number. */
export function parseScoringWeight(raw: string): number {
  return clampNumber(parseNumberOrFallback(raw, 1), 0, Number.MAX_SAFE_INTEGER, 1)
}

/**
 * Sanitise the required-relations rows: drops rows with an unrecognised (or
 * blank) relation type, defaults `direction` to "either", narrows `targetKind`
 * to a known kind or `null` ("any kind"), and clamps `min` to a non-negative
 * integer defaulting to 1.
 */
export function sanitiseRequiredRelations(rows: RequiredRelationRow[]): RequiredRelationInput[] {
  return rows
    .map((r) => ({ ...r, relationType: r.relationType.trim() }))
    .filter((r): r is RequiredRelationRow & { relationType: RelationType } => isRelationTypeValue(r.relationType))
    .map((r) => ({
      relationType: r.relationType,
      direction: r.direction === 'from' || r.direction === 'to' ? r.direction : 'either',
      targetKind: narrowTargetKind(r.targetKind),
      min: Math.round(
        clampNumber(parseNumberOrFallback(r.min, DEFAULT_MIN), 0, Number.MAX_SAFE_INTEGER, DEFAULT_MIN),
      ),
    }))
}

/**
 * Sanitise the required-metadata rows: drops rows with a blank path, trims
 * `path`, and normalises a blank `label` to `null`.
 */
export function sanitiseRequiredMetadata(rows: RequiredMetadataRow[]): RequiredMetadataInput[] {
  return rows
    .filter((m) => m.path.trim().length > 0)
    .map((m) => ({
      path: m.path.trim(),
      label: m.label.trim() ? m.label.trim() : null,
    }))
}

/**
 * Validate the required fields of an entity-type form ahead of submit.
 * Returns a user-facing error string, or `null` when the form is valid.
 * (Numeric fields are always valid — `parseBaseValue`/`parseScoringWeight`
 * clamp rather than reject — so only `displayName` is checked here.)
 */
export function validateEntityTypeForm(form: Pick<EntityTypeFormState, 'displayName'>): string | null {
  if (!form.displayName.trim()) return 'A display name is required.'
  return null
}

/**
 * Assemble the full `saveEntityType` payload for `kind` from the form state.
 * Pure: does not validate (call `validateEntityTypeForm` first) — always
 * produces a well-formed payload so the caller can rely on its shape.
 */
export function buildSaveEntityTypeInput(kind: string, form: EntityTypeFormState): SaveEntityTypeInput {
  return {
    kind,
    displayName: form.displayName.trim(),
    description: form.description.trim() ? form.description.trim() : null,
    baseValue: parseBaseValue(form.baseValue),
    scoringWeight: parseScoringWeight(form.scoringWeight),
    goldenPath: {
      summary: form.goldenPath.summary.trim() ? form.goldenPath.summary.trim() : null,
      docsUrl: form.goldenPath.docsUrl.trim() ? form.goldenPath.docsUrl.trim() : null,
      requiredRelations: sanitiseRequiredRelations(form.goldenPath.requiredRelations),
      requiredMetadata: sanitiseRequiredMetadata(form.goldenPath.requiredMetadata),
    },
  }
}
