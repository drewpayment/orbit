import {
  normalizeInputSchema,
  type ActionInputField,
  type ActionInputSchema,
} from '@/lib/actions/input-schema'

/**
 * Pure helpers for the Action InputSchemaBuilder (IDP refocus P3).
 *
 * The builder edits a list of {@link BuilderField} rows (each carrying a stable
 * client-only `id` for React keys + an always-present `options` array so the
 * select editor has somewhere to write). These helpers assemble that mutable
 * state into the shared {@link ActionInputSchema} contract, validate it for
 * human-readable authoring errors, hydrate it back for the edit form, and
 * reorder rows — all without React or Payload so they're unit-testable in
 * isolation. NO raw JSON is ever shown to the author.
 */

export interface BuilderField {
  /** Stable key for React lists; never persisted. */
  id: string
  name: string
  label: string
  type: ActionInputField['type']
  required: boolean
  /** Only meaningful for `type: 'select'`; kept across type switches for UX. */
  options: string[]
  help: string
  placeholder: string
}

export const FIELD_TYPE_OPTIONS: ReadonlyArray<{
  value: ActionInputField['type']
  label: string
}> = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
]

/** Field names become run-input object keys: letters, digits, _, -, . — no spaces. */
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/

let _idCounter = 0
/** Generate a stable client-only row id (not persisted). */
function nextId(): string {
  _idCounter += 1
  return `f_${Date.now().toString(36)}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`
}

/** A blank builder row, optionally pre-filled. */
export function createBuilderField(partial?: Partial<BuilderField>): BuilderField {
  return {
    id: nextId(),
    name: '',
    label: '',
    type: 'text',
    required: false,
    options: [],
    help: '',
    placeholder: '',
    ...partial,
  }
}

/** Clean a select field's options: trim, drop blanks, de-duplicate (stable order). */
function cleanOptions(options: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of options) {
    const v = typeof raw === 'string' ? raw.trim() : ''
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * Assemble the editor rows into the {@link ActionInputSchema} contract.
 * Rows with a blank `name` are dropped (treated as not-yet-filled). `label`
 * defaults to `name`; `options` survive only for `select`; `required`,
 * `help`, and `placeholder` are emitted only when meaningful — matching the
 * tolerant shape {@link normalizeInputSchema} produces.
 */
export function assembleInputSchema(fields: BuilderField[]): ActionInputSchema {
  const out: ActionInputField[] = []
  for (const f of fields) {
    const name = f.name.trim()
    if (!name) continue

    const field: ActionInputField = {
      name,
      label: f.label.trim() || name,
      type: f.type,
    }
    if (f.required) field.required = true
    if (f.type === 'select') {
      const options = cleanOptions(f.options)
      if (options.length > 0) field.options = options
    }
    const help = f.help.trim()
    if (help) field.help = help
    const placeholder = f.placeholder.trim()
    if (placeholder) field.placeholder = placeholder

    out.push(field)
  }
  return { fields: out }
}

/**
 * Validate the editor rows, returning the first human-readable error or `null`
 * when the schema is safe to save. Blank-named rows are reported (rather than
 * silently dropped) so the author fixes them; names must be unique and key-safe;
 * select rows need at least one option.
 */
export function validateBuilderFields(fields: BuilderField[]): string | null {
  const seen = new Set<string>()
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    const name = f.name.trim()
    const where = f.label.trim() || name || `Field ${i + 1}`

    if (!name) return `"${where}" needs a field name.`
    if (!NAME_PATTERN.test(name)) {
      return `Field name "${name}" may only contain letters, numbers, "_", "-", and ".".`
    }
    if (seen.has(name)) return `Duplicate field name "${name}".`
    seen.add(name)

    if (f.type === 'select' && cleanOptions(f.options).length === 0) {
      return `Select field "${where}" needs at least one option.`
    }
  }
  return null
}

/** Hydrate builder rows from a stored `Action.inputSchema` JSON value (edit mode). */
export function parseInputSchemaToBuilderFields(raw: unknown): BuilderField[] {
  const { fields } = normalizeInputSchema(raw)
  return fields.map((f) =>
    createBuilderField({
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required === true,
      options: f.options ?? [],
      help: f.help ?? '',
      placeholder: f.placeholder ?? '',
    }),
  )
}

/** Move the row at `index` by `delta` positions, clamped to the list bounds. */
export function moveField(fields: BuilderField[], index: number, delta: number): BuilderField[] {
  const target = index + delta
  if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) {
    return fields
  }
  const next = [...fields]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}
