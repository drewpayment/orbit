/**
 * Shared types for `SchemaForm` (Template Authoring Phase 2, Group A).
 *
 * `JsonSchema` is the draft 2020-12 SUBSET `SchemaForm` understands — it
 * deliberately does not model the full spec. `schema-to-zod.ts` throws
 * {@link UnsupportedSchemaError} for anything outside this subset (`oneOf`,
 * `anyOf`, `$ref`, …) rather than silently mis-converting it.
 *
 * `UiSchema` is Orbit's `ui:` vocabulary, modeled after Backstage/RJSF so it
 * reads familiarly to platform engineers. It is keyed by JSON Schema property
 * name at each nesting level (RJSF convention) plus a handful of form-level
 * keys under `ui:order`.
 */

/** JSON primitive/composite types this subset supports. */
export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'

/** A single JSON Schema (draft 2020-12 subset) node. */
export interface JsonSchema {
  type?: JsonSchemaType
  title?: string
  description?: string
  default?: unknown

  // string
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: 'email' | 'uri' | 'date' | 'date-time' | (string & {})
  enum?: Array<string | number>

  // number / integer
  minimum?: number
  maximum?: number
  multipleOf?: number

  // array
  items?: JsonSchema
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean

  // object
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema

  // Unsupported-but-recognized (detected explicitly so we can throw a clear
  // error instead of silently ignoring them — see UnsupportedSchemaError).
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  $ref?: string
}

/** Thrown by `jsonSchemaToZod` for schema shapes outside the supported subset. */
export class UnsupportedSchemaError extends Error {
  readonly code = 'UNSUPPORTED_SCHEMA' as const
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedSchemaError'
  }
}

/**
 * Per-field `ui:` directives, keyed by JSON Schema property name (RJSF
 * convention). `ui:order` is form-level: an array of property names (or a
 * trailing `'*'` for "everything else, in schema order").
 */
export interface UiFieldSchema {
  /** Force a specific registered field component by name (e.g. `OrbitTeamPicker`). */
  'ui:field'?: string
  /** Force a widget for the default renderer (e.g. `textarea` for a string). */
  'ui:widget'?: 'textarea' | 'password' | (string & {})
  /** Inline help text rendered under the field. */
  'ui:help'?: string
  /**
   * Visibility expression, e.g. `${{ parameters.foo }}` or
   * `${{ parameters.foo == 'bar' }}`. See `visible-if.ts`.
   */
  'ui:visibleIf'?: string
  /** Marks the field's value as sensitive — masked input, redacted on emit. */
  'ui:secret'?: boolean
  /** Placeholder text. */
  'ui:placeholder'?: string
  /** Extra props passed through to the resolved field component. */
  'ui:options'?: Record<string, unknown>
}

export type UiSchema = {
  /** Form-level field ordering. */
  'ui:order'?: string[]
} & Record<string, UiFieldSchema | string[] | undefined>

/** One page of a (possibly multi-page) SchemaForm. */
export interface SchemaFormPage {
  title: string
  schema: JsonSchema
  uiSchema?: UiSchema
}

/** A value emitted for a `ui:secret` field — flagged so callers can redact it. */
export interface SecretValue {
  value: string
  secret: true
}
