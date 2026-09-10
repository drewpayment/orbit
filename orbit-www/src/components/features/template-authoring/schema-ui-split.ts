/**
 * Adapts between the wire format's inline `ui:*` property keys (design §3.1 —
 * `{ type: 'string', 'ui:field': 'OrbitTeamPicker' }`) and `SchemaForm`'s
 * `{ schema, uiSchema }` props shape (`ui:` keyed by property name at the
 * page level, per `orbit-www/src/components/forms/schema-form/types.ts`).
 *
 * Pure, framework-free — used by `ParametersBuilder`/`ParametersPreview`
 * (Task 10) and `StepsBuilder` (Task 11, for rendering a step's registry
 * `inputSchema` — which is plain JSON Schema with no inline `ui:*`, so
 * `splitProperty` is a no-op there beyond stripping `type`/schema keys).
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

/**
 * Merges `workspaceId` into a field's `ui:options` without disturbing any
 * `ui:options` the field already carries (e.g. `OrbitEntityPicker`'s `kind`).
 * A no-op when `workspaceId` is omitted, so existing callers that don't pass
 * one are unaffected.
 */
function withWorkspaceId(ui: UiFieldSchema, workspaceId: string | undefined): UiFieldSchema {
  if (!workspaceId) return ui
  const existingOptions = (ui as Record<string, unknown>)['ui:options'] as Record<string, unknown> | undefined
  return { ...ui, 'ui:options': { ...existingOptions, workspaceId } } as UiFieldSchema
}

/**
 * Convert one wire-format `ParameterPage` into a `SchemaForm`-ready page.
 *
 * `workspaceId`, when passed, is injected into `ui:options.workspaceId` for
 * every `ui:*`-tagged property (Orbit pickers read `ui:options.workspaceId`
 * — see `orbit-picker-types.ts` — and have no other channel to learn which
 * workspace to scope their lookup to). Callers that render a live picker
 * (the run wizard, the parameters live preview) must pass this or every
 * Orbit picker on the page renders permanently empty.
 */
export function parameterPageToSchemaFormPage(page: ParameterPage, workspaceId?: string): SchemaFormPage {
  const properties: Record<string, JsonSchema> = {}
  const uiSchema: UiSchema = {}
  for (const [name, property] of Object.entries(page.properties)) {
    const { schema, ui } = splitProperty(property)
    properties[name] = schema
    if (Object.keys(ui).length > 0) {
      ;(uiSchema as Record<string, UiFieldSchema>)[name] = withWorkspaceId(ui, workspaceId)
    }
  }
  return {
    title: page.title,
    schema: { type: 'object', properties, required: page.required ?? [] },
    uiSchema,
  }
}

/**
 * Convert a step's registry `inputSchema` to a single-page form.
 *
 * A property MAY carry inline `ui:*` keys (design §3.1's wire format — e.g.
 * `{ type: 'string', 'ui:field': 'OrbitSkeletonPicker' }`) exactly like a
 * parameter page's properties do; this is how a Go action's InputSchema
 * requests a picker for one of its inputs (`fetch:orbit-skeleton`'s
 * `skeletonId`, Phase 3 Task 5). Split each property with {@link
 * splitProperty}, same as {@link parameterPageToSchemaFormPage}, so
 * `SchemaForm`'s registry-driven field resolution sees the `ui:field`.
 *
 * `workspaceId`, when passed, is injected into `ui:options.workspaceId` for
 * every `ui:*`-tagged input (see {@link parameterPageToSchemaFormPage}'s doc
 * comment) — `StepsBuilder` must pass the template definition's workspace so
 * a step's `OrbitSkeletonPicker`/etc. can actually list something.
 */
export function stepInputSchemaToSchemaFormPage(
  title: string,
  inputSchema: Record<string, unknown>,
  workspaceId?: string,
): SchemaFormPage {
  const schema = inputSchema as JsonSchema
  const rawProperties = (schema.properties ?? {}) as Record<string, ParameterProperty>
  const properties: Record<string, JsonSchema> = {}
  const uiSchema: UiSchema = {}
  for (const [name, property] of Object.entries(rawProperties)) {
    const { schema: propSchema, ui } = splitProperty(property)
    properties[name] = propSchema
    if (Object.keys(ui).length > 0) {
      ;(uiSchema as Record<string, UiFieldSchema>)[name] = withWorkspaceId(ui, workspaceId)
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
