/**
 * Pure builders + validators for scorecard rule `expression` JSON (IDP refocus P2).
 *
 * Rules are DATA, not code: each scorecard-rule carries a JSON `expression`
 * interpreted by lib/scorecards/evaluate per `type`. This module is the single
 * place that ASSEMBLES those expressions from form inputs and VALIDATES an
 * expression against its type before it is persisted. The three shapes (kept in
 * lockstep with the evaluator and the ScorecardRules collection doc) are:
 *
 *   - field-presence: { path, op: 'exists' | 'not-empty' }
 *   - relation-check: { relationType, direction: 'from'|'to'|'either',
 *                       targetKind?, min }
 *   - threshold:      { path, op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in', value }
 *
 * Deliberately framework-light: no 'use server', no React, no Payload imports —
 * so both the client RuleBuilder and the server authoring actions import these
 * and the round-trip stays unit-testable (see rule-builder.test.ts).
 */

// Import the vocabularies from the framework-light constants module, NOT the
// `@/collections/catalog` barrel: this module is reachable from the client
// RuleBuilder, and the barrel would drag the collection configs (and their
// server-only automation hooks) into the browser bundle.
import { ENTITY_KINDS, RELATION_TYPES } from '@/collections/catalog/constants'

// --- option vocabularies (drive the builder dropdowns) ----------------------

export type RuleType = 'field-presence' | 'relation-check' | 'threshold'
export type FieldPresenceOp = 'exists' | 'not-empty'
export type ThresholdOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
export type RelationDirection = 'from' | 'to' | 'either'

export const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: 'field-presence', label: 'Field presence' },
  { value: 'relation-check', label: 'Relation check' },
  { value: 'threshold', label: 'Threshold' },
]

export const FIELD_PRESENCE_OPS: { value: FieldPresenceOp; label: string }[] = [
  { value: 'exists', label: 'exists (is set)' },
  { value: 'not-empty', label: 'not empty' },
]

export const THRESHOLD_OPS: { value: ThresholdOp; label: string }[] = [
  { value: 'eq', label: '= equals' },
  { value: 'neq', label: '≠ not equals' },
  { value: 'gt', label: '> greater than' },
  { value: 'gte', label: '≥ greater or equal' },
  { value: 'lt', label: '< less than' },
  { value: 'lte', label: '≤ less or equal' },
  { value: 'in', label: 'in (one of)' },
]

export const RELATION_DIRECTIONS: { value: RelationDirection; label: string }[] = [
  { value: 'either', label: 'either direction' },
  { value: 'from', label: 'from this entity' },
  { value: 'to', label: 'to this entity' },
]

/** Relation types offered in the relation-check builder (mirrors the catalog). */
export const RELATION_TYPE_OPTIONS = RELATION_TYPES as readonly string[]
/** Entity kinds offered as the relation-check target / scorecard applies-to. */
export const ENTITY_KIND_OPTIONS = ENTITY_KINDS as readonly string[]

const THRESHOLD_OP_VALUES = THRESHOLD_OPS.map((o) => o.value)
const NUMERIC_OPS: ThresholdOp[] = ['gt', 'gte', 'lt', 'lte']

// --- scoreable entity fields (drive the schema-aware field pickers) ---------

export type ScoreableValueType = 'text' | 'enum' | 'number' | 'relationship' | 'array'

export interface ScoreableField {
  path: string
  label: string
  valueType: ScoreableValueType
  enumOptions?: readonly string[]
  help?: string
}

/** Conventional prefix for custom/freeform fields (e.g. metadata.costCenter). */
export const METADATA_PREFIX = 'metadata.'

/**
 * The CatalogEntity fields a rule can target — mirrored from
 * collections/catalog/CatalogEntities.ts. `valueType` drives the threshold value
 * control; `enumOptions` lists the allowed values for select fields. Any field
 * not listed here is reachable by typing a custom path into the field combobox.
 */
export const SCOREABLE_FIELDS: ScoreableField[] = [
  { path: 'name', label: 'Name', valueType: 'text' },
  { path: 'slug', label: 'Slug', valueType: 'text' },
  { path: 'description', label: 'Description', valueType: 'text' },
  {
    path: 'owner',
    label: 'Owning team',
    valueType: 'relationship',
    help: 'The team that owns this entity.',
  },
  { path: 'kind', label: 'Kind', valueType: 'enum', enumOptions: ENTITY_KIND_OPTIONS },
  {
    path: 'lifecycle',
    label: 'Lifecycle',
    valueType: 'enum',
    enumOptions: ['experimental', 'production', 'deprecated'],
  },
  { path: 'tier', label: 'Tier', valueType: 'enum', enumOptions: ['tier-1', 'tier-2', 'tier-3'] },
  {
    path: 'health',
    label: 'Health',
    valueType: 'enum',
    enumOptions: ['healthy', 'degraded', 'down', 'unknown'],
  },
  { path: 'links', label: 'Links', valueType: 'array', help: 'Docs, dashboards, runbooks.' },
]

/** Look up a known scoreable field by its path. */
export function fieldByPath(path: string): ScoreableField | undefined {
  return SCOREABLE_FIELDS.find((f) => f.path === path)
}

/**
 * The value-input kind for a threshold's value control given the chosen field:
 * enum field → 'enum' (pick from its options), number field → 'number', and
 * everything else (text, relationship, array, custom metadata, unknown) → 'text'.
 * `op` is accepted for future per-operator narrowing; the kind is field-driven.
 */
export function valueInputType(path: string, _op?: ThresholdOp): 'enum' | 'number' | 'text' {
  const field = fieldByPath(path)
  if (field?.valueType === 'enum') return 'enum'
  if (field?.valueType === 'number') return 'number'
  return 'text'
}

/** Threshold operators valid for a field — enum fields narrow to eq/neq/in. */
export function thresholdOpsForPath(path: string): { value: ThresholdOp; label: string }[] {
  const field = fieldByPath(path)
  if (field?.valueType === 'enum') {
    return THRESHOLD_OPS.filter((o) => o.value === 'eq' || o.value === 'neq' || o.value === 'in')
  }
  return THRESHOLD_OPS
}

/** One-line explanation of what each rule type checks, shown under the selector. */
export const RULE_TYPE_HELP: Record<RuleType, string> = {
  'field-presence': 'Passes when the chosen field is set / non-empty on the entity.',
  'relation-check': 'Passes when the entity has at least N relations of the chosen type.',
  threshold: 'Passes when the chosen field compares to the value.',
}

// --- form shapes (the controlled state the builder edits) -------------------

export interface FieldPresenceForm {
  type: 'field-presence'
  path: string
  op: FieldPresenceOp
}

export interface RelationCheckForm {
  type: 'relation-check'
  relationType: string
  direction: RelationDirection
  targetKind?: string
  min: number
}

export interface ThresholdForm {
  type: 'threshold'
  path: string
  op: ThresholdOp
  /** Raw text from the input; `in` is comma-separated. Coerced in buildExpression. */
  value: string
}

export type RuleForm = FieldPresenceForm | RelationCheckForm | ThresholdForm

// --- helpers ----------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

const NUMERIC_RE = /^-?\d*\.?\d+$/

/** Coerce a raw input token to a number when it is purely numeric, else trim it. */
export function coerceScalar(raw: string): string | number {
  const t = raw.trim()
  if (t !== '' && NUMERIC_RE.test(t)) {
    const n = Number(t)
    if (!Number.isNaN(n)) return n
  }
  return t
}

// --- buildExpression --------------------------------------------------------

/**
 * Assemble the persisted `expression` object from builder form state. The output
 * matches exactly what lib/scorecards/evaluate interprets; pair every call with
 * {@link validateExpression} before persisting.
 */
export function buildExpression(form: RuleForm): Record<string, unknown> {
  switch (form.type) {
    case 'field-presence':
      return { path: form.path.trim(), op: form.op }

    case 'relation-check': {
      const expr: Record<string, unknown> = {
        relationType: form.relationType,
        direction: form.direction,
        min: Number.isFinite(form.min) ? form.min : 1,
      }
      const targetKind = form.targetKind?.trim()
      if (targetKind) expr.targetKind = targetKind
      return expr
    }

    case 'threshold': {
      const value =
        form.op === 'in'
          ? form.value
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
              .map(coerceScalar)
          : coerceScalar(form.value)
      return { path: form.path.trim(), op: form.op, value }
    }
  }
}

// --- validateExpression -----------------------------------------------------

/**
 * Validate an `expression` against its rule `type`: shape + required fields +
 * enum membership. Returns a human-readable error string, or `null` when valid.
 * The authoring server actions throw on any non-null result so a malformed rule
 * can never be persisted, and the builder uses it for inline feedback.
 */
export function validateExpression(type: string, expression: unknown): string | null {
  if (!isRecord(expression)) {
    return 'Expression must be an object.'
  }

  switch (type) {
    case 'field-presence': {
      const { path, op } = expression
      if (typeof path !== 'string' || !path.trim()) {
        return 'Field presence: a non-empty path is required (e.g. owner, metadata.costCenter).'
      }
      if (op !== 'exists' && op !== 'not-empty') {
        return 'Field presence: op must be "exists" or "not-empty".'
      }
      return null
    }

    case 'relation-check': {
      const { relationType, direction, targetKind, min } = expression
      if (typeof relationType !== 'string' || !relationType) {
        return 'Relation check: a relation type is required.'
      }
      if (!RELATION_TYPE_OPTIONS.includes(relationType)) {
        return `Relation check: unknown relation type "${relationType}".`
      }
      if (
        direction !== undefined &&
        direction !== 'from' &&
        direction !== 'to' &&
        direction !== 'either'
      ) {
        return 'Relation check: direction must be from, to, or either.'
      }
      if (
        targetKind !== undefined &&
        targetKind !== null &&
        targetKind !== '' &&
        !(typeof targetKind === 'string' && ENTITY_KIND_OPTIONS.includes(targetKind))
      ) {
        return `Relation check: unknown target kind "${String(targetKind)}".`
      }
      if (min !== undefined && (typeof min !== 'number' || Number.isNaN(min) || min < 0)) {
        return 'Relation check: min must be a non-negative number.'
      }
      return null
    }

    case 'threshold': {
      const { path, op, value } = expression
      if (typeof path !== 'string' || !path.trim()) {
        return 'Threshold: a non-empty path is required.'
      }
      if (typeof op !== 'string' || !THRESHOLD_OP_VALUES.includes(op as ThresholdOp)) {
        return 'Threshold: an operator is required.'
      }
      if (op === 'in') {
        if (!Array.isArray(value) || value.length === 0) {
          return 'Threshold: "in" requires a non-empty list of values.'
        }
      } else if (NUMERIC_OPS.includes(op as ThresholdOp)) {
        const n = typeof value === 'number' ? value : Number(value)
        if (value === '' || value == null || Number.isNaN(n)) {
          return `Threshold: operator "${op}" needs a numeric value.`
        }
      } else {
        // eq / neq
        if (value === undefined || value === null || value === '') {
          return 'Threshold: a value is required.'
        }
      }
      return null
    }

    default:
      return `Unknown rule type "${type}".`
  }
}

// --- parseExpression (edit round-trip) --------------------------------------

const DEFAULT_FORMS: Record<RuleType, RuleForm> = {
  'field-presence': { type: 'field-presence', path: '', op: 'exists' },
  'relation-check': { type: 'relation-check', relationType: RELATION_TYPE_OPTIONS[0], direction: 'either', targetKind: '', min: 1 },
  threshold: { type: 'threshold', path: '', op: 'eq', value: '' },
}

/** A blank, valid-by-construction form for a freshly chosen rule type. */
export function defaultForm(type: RuleType): RuleForm {
  return { ...DEFAULT_FORMS[type] }
}

/** Render a stored scalar/array back into the builder's raw text field. */
function scalarToText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ')
  if (v == null) return ''
  return String(v)
}

/**
 * Hydrate builder form state from a persisted (type, expression) pair so an
 * existing rule can be edited. Falls back to a blank form for the type when the
 * stored expression is missing fields.
 */
export function parseExpression(type: RuleType, expression: unknown): RuleForm {
  const expr = isRecord(expression) ? expression : {}
  switch (type) {
    case 'field-presence':
      return {
        type,
        path: typeof expr.path === 'string' ? expr.path : '',
        op: expr.op === 'not-empty' ? 'not-empty' : 'exists',
      }
    case 'relation-check':
      return {
        type,
        relationType:
          typeof expr.relationType === 'string' ? expr.relationType : RELATION_TYPE_OPTIONS[0],
        direction:
          expr.direction === 'from' || expr.direction === 'to' ? expr.direction : 'either',
        targetKind: typeof expr.targetKind === 'string' ? expr.targetKind : '',
        min: typeof expr.min === 'number' ? expr.min : 1,
      }
    case 'threshold':
      return {
        type,
        path: typeof expr.path === 'string' ? expr.path : '',
        op: THRESHOLD_OP_VALUES.includes(expr.op as ThresholdOp) ? (expr.op as ThresholdOp) : 'eq',
        value: scalarToText(expr.value),
      }
  }
}
