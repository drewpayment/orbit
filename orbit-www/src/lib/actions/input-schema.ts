/**
 * Action input schema — the SHARED CONTRACT between the run form (UI),
 * the authoring form (UI), and the runner (server) for self-service Actions
 * (IDP refocus P3).
 *
 * This module is intentionally PURE: no 'use server', no React, no Payload
 * imports. It is safe to import from both client components (to render the run
 * form / author fields) and server code (to validate inputs before a run). The
 * Action.inputSchema JSON column is parsed through {@link normalizeInputSchema}
 * into the strongly-typed {@link ActionInputSchema} this file owns.
 *
 * Keep the field/schema shapes here stable — Engineers B & C import them.
 */

/** One field in an Action's run form. */
export interface ActionInputField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  required?: boolean
  /** Allowed values for `type: 'select'`. */
  options?: string[]
  help?: string
  placeholder?: string
}

/** The full set of fields collected before an Action runs. */
export interface ActionInputSchema {
  fields: ActionInputField[]
}

const FIELD_TYPES: ReadonlyArray<ActionInputField['type']> = [
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
]

/** Coerce an unknown value to a clean string array (drops non-strings/blanks). */
function toStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  return out.length > 0 ? out : undefined
}

/**
 * Tolerant parse of the raw `Action.inputSchema` JSON column into an
 * {@link ActionInputSchema}. Anything malformed degrades to `{ fields: [] }`
 * (a no-input Action) rather than throwing — the run form simply renders no
 * fields. Accepts a JSON string, an object with a `fields` array, or a bare
 * array of fields. Only well-formed fields (string `name`, known `type`)
 * survive; `label` defaults to `name` when missing.
 */
export function normalizeInputSchema(raw: unknown): ActionInputSchema {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { fields: [] }
    }
  }

  let rawFields: unknown
  if (Array.isArray(value)) {
    rawFields = value
  } else if (value && typeof value === 'object' && Array.isArray((value as { fields?: unknown }).fields)) {
    rawFields = (value as { fields: unknown }).fields
  } else {
    return { fields: [] }
  }

  const fields: ActionInputField[] = []
  for (const entry of rawFields as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const f = entry as Record<string, unknown>
    const name = typeof f.name === 'string' ? f.name.trim() : ''
    if (!name) continue
    const type = (FIELD_TYPES as readonly string[]).includes(f.type as string)
      ? (f.type as ActionInputField['type'])
      : 'text'

    const field: ActionInputField = {
      name,
      label: typeof f.label === 'string' && f.label.trim() ? f.label.trim() : name,
      type,
    }
    if (f.required === true) field.required = true
    if (type === 'select') {
      const options = toStringArray(f.options)
      if (options) field.options = options
    }
    if (typeof f.help === 'string' && f.help.trim()) field.help = f.help.trim()
    if (typeof f.placeholder === 'string' && f.placeholder.trim()) {
      field.placeholder = f.placeholder.trim()
    }
    fields.push(field)
  }

  return { fields }
}

/** A coerced number, or null when the value cannot be a finite number. */
function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Coerce common truthy/falsy encodings (checkbox/select/string) to a boolean. */
function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    return v === 'true' || v === '1' || v === 'yes' || v === 'on'
  }
  return false
}

/** True when a value is "missing" for required-field purposes. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * Validate + coerce a run's raw input `values` against a (normalized) schema.
 *
 * - Required fields must be present and non-empty.
 * - `number` fields are coerced to a finite number (rejects non-numeric).
 * - `boolean` fields are coerced from checkbox/string encodings.
 * - `select` fields must be one of the declared `options` (when options exist).
 * - Unknown keys (not in the schema) are dropped from the returned values.
 *
 * Returns the cleaned values on success, or a single human-readable `error`.
 * A null/empty schema validates trivially to `{ fields: [] }` → no inputs.
 */
export function validateInputs(
  schema: ActionInputSchema | null | undefined,
  values: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const fields = schema?.fields ?? []
  const out: Record<string, unknown> = {}

  for (const field of fields) {
    const raw = values?.[field.name]

    if (isEmpty(raw)) {
      if (field.required) {
        return { ok: false, error: `"${field.label}" is required.` }
      }
      // Optional + empty: skip (don't write an empty value).
      continue
    }

    switch (field.type) {
      case 'number': {
        const n = coerceNumber(raw)
        if (n === null) {
          return { ok: false, error: `"${field.label}" must be a number.` }
        }
        out[field.name] = n
        break
      }
      case 'boolean': {
        out[field.name] = coerceBoolean(raw)
        break
      }
      case 'select': {
        const str = String(raw)
        if (field.options && field.options.length > 0 && !field.options.includes(str)) {
          return {
            ok: false,
            error: `"${field.label}" must be one of: ${field.options.join(', ')}.`,
          }
        }
        out[field.name] = str
        break
      }
      case 'text':
      case 'textarea':
      default: {
        out[field.name] = typeof raw === 'string' ? raw : String(raw)
        break
      }
    }
  }

  return { ok: true, values: out }
}
