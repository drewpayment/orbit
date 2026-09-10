/**
 * Adapter: an Action's `ActionInputSchema` (`input-schema.ts`) → `SchemaForm`'s
 * JSON Schema + ui schema (Template Authoring Phase 2, Group A Task 6). Lets
 * `RunActionDialog` migrate onto `SchemaForm` without touching the
 * authoring-side `InputSchemaBuilder`/`BuilderField` shape.
 *
 * Pure — no React/Next imports.
 */
import type { JsonSchema, UiFieldSchema, UiSchema } from '@/components/forms/schema-form/types'
import type { ActionInputField, ActionInputSchema } from './input-schema'

export interface InputSchemaJsonSchemaConversion {
  schema: JsonSchema
  uiSchema: UiSchema
}

function fieldPropertySchema(field: ActionInputField): JsonSchema {
  const base: JsonSchema = { title: field.label }
  switch (field.type) {
    case 'number':
      return { ...base, type: 'number' }
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'select':
      return { ...base, type: 'string', enum: field.options ?? [] }
    case 'textarea':
    case 'text':
    default:
      return { ...base, type: 'string' }
  }
}

function fieldUiSchema(field: ActionInputField): UiFieldSchema | undefined {
  const ui: UiFieldSchema = {}
  if (field.type === 'textarea') ui['ui:widget'] = 'textarea'
  if (field.help) ui['ui:help'] = field.help
  if (field.placeholder) ui['ui:placeholder'] = field.placeholder
  return Object.keys(ui).length > 0 ? ui : undefined
}

export function inputSchemaToJsonSchema(schema: ActionInputSchema): InputSchemaJsonSchemaConversion {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const uiSchema: UiSchema = {}

  for (const field of schema.fields) {
    properties[field.name] = fieldPropertySchema(field)
    if (field.required) required.push(field.name)
    const ui = fieldUiSchema(field)
    if (ui) uiSchema[field.name] = ui
  }

  return {
    schema: { type: 'object', properties, required },
    uiSchema,
  }
}
