/**
 * Pure row model for `ParametersBuilder` (Task 10) — mirrors
 * `orbit-www/src/components/features/actions/input-schema-builder.ts`'s
 * shape, extended for full JSON Schema + the `ui:` vocabulary and pages.
 *
 * A `ParameterFieldRow` is the editor's view of one property; `propertyFromRow`
 * assembles it back into the wire-format `ParameterProperty` (inline `ui:*`
 * keys, per `schema-ui-split.ts`) that `builder-state.ts`'s `ADD_FIELD`/
 * `UPDATE_FIELD` actions store.
 */
import type { ParameterProperty } from './builder-state'

export type ParameterFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'

export const PARAMETER_FIELD_TYPE_OPTIONS: ReadonlyArray<{ value: ParameterFieldType; label: string }> = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'array', label: 'List (tags)' },
  { value: 'object', label: 'Group' },
]

export const UI_FIELD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Default widget' },
  { value: 'OrbitTeamPicker', label: 'Team picker' },
  { value: 'OrbitWorkspacePicker', label: 'Workspace picker' },
  { value: 'OrbitEntityPicker', label: 'Entity picker' },
  { value: 'OrbitRepoPicker', label: 'Repo picker' },
]

export interface ParameterFieldRow {
  /** Stable key for React lists; never persisted. */
  id: string
  /** Current field name (the properties-object key). */
  name: string
  type: ParameterFieldType
  label: string
  help: string
  required: boolean
  /** Raw text form of the default value; parsed per `type` on assemble. */
  defaultValue: string
  pattern: string
  minLength: string
  maxLength: string
  minimum: string
  maximum: string
  /** Comma-separated enum options (string enums only, matching the type-default Select field). */
  enumOptions: string
  visibleIf: string
  uiField: string
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

let _idCounter = 0
function nextId(): string {
  _idCounter += 1
  return `pf_${Date.now().toString(36)}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`
}

export function createParameterFieldRow(partial?: Partial<ParameterFieldRow>): ParameterFieldRow {
  return {
    id: nextId(),
    name: '',
    type: 'string',
    label: '',
    help: '',
    required: false,
    defaultValue: '',
    pattern: '',
    minLength: '',
    maxLength: '',
    minimum: '',
    maximum: '',
    enumOptions: '',
    visibleIf: '',
    uiField: '',
    ...partial,
  }
}

function inferType(property: ParameterProperty): ParameterFieldType {
  const t = property.type
  if (t === 'number' || t === 'integer' || t === 'boolean' || t === 'array' || t === 'object') return t
  return 'string'
}

function stringifyDefault(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Hydrate a row from a stored property (edit mode) — the inverse of {@link propertyFromRow}. */
export function rowFromNameAndProperty(
  name: string,
  property: ParameterProperty,
  required: boolean,
): ParameterFieldRow {
  const enumValues = Array.isArray(property.enum) ? (property.enum as unknown[]) : []
  return createParameterFieldRow({
    name,
    type: inferType(property),
    label: typeof property.title === 'string' ? property.title : '',
    help: typeof property['ui:help'] === 'string' ? (property['ui:help'] as string) : '',
    required,
    defaultValue: stringifyDefault(property.default),
    pattern: typeof property.pattern === 'string' ? property.pattern : '',
    minLength: property.minLength !== undefined ? String(property.minLength) : '',
    maxLength: property.maxLength !== undefined ? String(property.maxLength) : '',
    minimum: property.minimum !== undefined ? String(property.minimum) : '',
    maximum: property.maximum !== undefined ? String(property.maximum) : '',
    enumOptions: enumValues.map((v) => String(v)).join(', '),
    visibleIf: typeof property['ui:visibleIf'] === 'string' ? (property['ui:visibleIf'] as string) : '',
    uiField: typeof property['ui:field'] === 'string' ? (property['ui:field'] as string) : '',
  })
}

function parseDefaultValue(row: ParameterFieldRow): unknown {
  const raw = row.defaultValue.trim()
  if (!raw) return undefined
  if (row.type === 'boolean') return raw === 'true'
  if (row.type === 'number' || row.type === 'integer') {
    const n = Number(raw)
    return Number.isNaN(n) ? undefined : n
  }
  return raw
}

/** Assemble a row into the wire-format property object (inline `ui:*` keys). */
export function propertyFromRow(row: ParameterFieldRow): ParameterProperty {
  const property: ParameterProperty = { type: row.type }
  if (row.label.trim()) property.title = row.label.trim()
  if (row.help.trim()) property['ui:help'] = row.help.trim()
  if (row.visibleIf.trim()) property['ui:visibleIf'] = row.visibleIf.trim()
  if (row.uiField.trim()) property['ui:field'] = row.uiField.trim()

  const defaultValue = parseDefaultValue(row)
  if (defaultValue !== undefined) property.default = defaultValue

  if (row.type === 'string') {
    if (row.pattern.trim()) property.pattern = row.pattern.trim()
    if (row.minLength.trim()) property.minLength = Number(row.minLength)
    if (row.maxLength.trim()) property.maxLength = Number(row.maxLength)
    const options = row.enumOptions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (options.length > 0) property.enum = options
  }
  if (row.type === 'number' || row.type === 'integer') {
    if (row.minimum.trim()) property.minimum = Number(row.minimum)
    if (row.maximum.trim()) property.maximum = Number(row.maximum)
  }
  if (row.type === 'array') {
    property.items = { type: 'string' }
  }
  if (row.type === 'object') {
    property.properties = {}
  }

  return property
}

/**
 * True when renaming a field from `currentName` to `newName` would collide
 * with a sibling field already on the page. A field "renamed" to its own
 * current name is never a collision. Shared by `builder-state.ts`'s
 * `UPDATE_FIELD` reducer (the authoritative no-op guard) and
 * `ParametersBuilder`'s inline validation (so the UI can warn before even
 * dispatching).
 */
export function isDuplicateFieldName(
  existingNames: string[],
  currentName: string,
  newName: string,
): boolean {
  return newName !== currentName && existingNames.includes(newName)
}

/**
 * Validate a page's rows, returning the first human-readable error or `null`.
 * Names must be identifier-safe and unique within the page.
 */
export function validateParameterFieldRows(rows: ParameterFieldRow[]): string | null {
  const seen = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const name = row.name.trim()
    const where = row.label.trim() || name || `Field ${i + 1}`
    if (!name) return `"${where}" needs a field name.`
    if (!NAME_PATTERN.test(name)) {
      return `Field name "${name}" must start with a letter or underscore and contain only letters, numbers, and underscores.`
    }
    if (seen.has(name)) return `Duplicate field name "${name}".`
    seen.add(name)
  }
  return null
}
