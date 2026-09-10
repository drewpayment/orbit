/**
 * Adapts between the wire format's inline `ui:*` property keys (design §3.1 —
 * `{ type: 'string', 'ui:field': 'OrbitTeamPicker' }`) and `SchemaForm`'s
 * `{ schema, uiSchema }` props shape (`ui:` keyed by property name at the
 * page level, per `orbit-www/src/components/forms/schema-form/types.ts`).
 *
 * Pure, framework-free — used by `ParametersBuilder`/`ParametersPreview`
 * (Task 10) and `StepsBuilder` (Task 11, for rendering a step's registry
 * `inputSchema`). A registry `inputSchema` is a plain Go-side JSON Schema,
 * but an action is free to attach the same inline `ui:*` vocabulary on a
 * property (e.g. `{ type: 'string', 'ui:widget': 'textarea' }` for a
 * multi-line field — see `api:schema:register`'s `content` input) —
 * `stepInputSchemaToSchemaFormPage` splits those out via `splitProperty`
 * exactly like `parameterPageToSchemaFormPage` does, so they render the same
 * way a hand-authored parameter page's `ui:*` keys do.
 */
import type { ParameterPage, Step } from '@/lib/scaffolder/schema'
import type { ParameterProperty } from './builder-state'
import type { JsonSchema, SchemaFormPage, UiFieldSchema, UiSchema } from '@/components/forms/schema-form/types'

const UI_PREFIX = 'ui:'

/** Split one property object into its plain JSON-Schema part and its `ui:*` part. */
export function splitProperty(property: ParameterProperty): { schema: JsonSchema; ui: UiFieldSchema } {
  const schema: Record<string, unknown> = {}
  const ui: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(property)) {
    if (key.startsWith(UI_PREFIX)) {
      ui[key] = value
    } else {
      schema[key] = value
    }
  }
  return { schema: schema as JsonSchema, ui: ui as UiFieldSchema }
}

/** Inverse of {@link splitProperty}: merge a JSON-Schema node with its `ui:*` directives. */
export function mergeProperty(schema: JsonSchema, ui?: UiFieldSchema): ParameterProperty {
  return { ...(schema as Record<string, unknown>), ...(ui as Record<string, unknown> | undefined) }
}

/** Convert one wire-format `ParameterPage` into a `SchemaForm`-ready page. */
export function parameterPageToSchemaFormPage(page: ParameterPage): SchemaFormPage {
  const properties: Record<string, JsonSchema> = {}
  const uiSchema: UiSchema = {}
  for (const [name, property] of Object.entries(page.properties)) {
    const { schema, ui } = splitProperty(property)
    properties[name] = schema
    if (Object.keys(ui).length > 0) {
      ;(uiSchema as Record<string, UiFieldSchema>)[name] = ui
    }
  }
  return {
    title: page.title,
    schema: { type: 'object', properties, required: page.required ?? [] },
    uiSchema,
  }
}

/**
 * Convert a step's registry `inputSchema` to a single-page form, splitting
 * any inline `ui:*` keys a property carries into the page's `uiSchema` (same
 * transform `parameterPageToSchemaFormPage` applies to authored parameter
 * pages) so e.g. `ui:widget: 'textarea'` on an action's input actually
 * resolves to the textarea field component instead of being silently
 * ignored.
 */
export function stepInputSchemaToSchemaFormPage(
  title: string,
  inputSchema: Record<string, unknown>,
): SchemaFormPage {
  const schema = inputSchema as JsonSchema
  const rawProperties = (schema.properties ?? {}) as Record<string, ParameterProperty>
  const properties: Record<string, JsonSchema> = {}
  const uiSchema: UiSchema = {}
  for (const [name, property] of Object.entries(rawProperties)) {
    const { schema: propSchema, ui } = splitProperty(property)
    properties[name] = propSchema
    if (Object.keys(ui).length > 0) {
      ;(uiSchema as Record<string, UiFieldSchema>)[name] = ui
    }
  }
  return {
    title,
    schema: { type: 'object', properties, required: schema.required ?? [] },
    uiSchema,
  }
}

/** True when a leaf JSON-Schema type may hold a `${{ }}` expression value (design §2.6: string/number fields). */
export function isExpressionCapable(schema: JsonSchema | undefined): boolean {
  return schema?.type === 'string' || schema?.type === 'number' || schema?.type === 'integer'
}

/** All top-level input field names of a step's action that accept expressions. */
export function expressionCapableFieldNames(inputSchema: Record<string, unknown>): string[] {
  const properties = (inputSchema.properties ?? {}) as Record<string, JsonSchema>
  return Object.entries(properties)
    .filter(([, schema]) => isExpressionCapable(schema))
    .map(([name]) => name)
}

/** Reference to a step for building expression autocomplete / grouped pickers — re-exported for convenience. */
export type { Step }
