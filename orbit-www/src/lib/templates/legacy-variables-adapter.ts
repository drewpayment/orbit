/**
 * Adapter: legacy v1 `TemplateVariable[]` → `SchemaForm`'s JSON Schema
 * (Template Authoring Phase 2, Group A Task 6). Lets `UseTemplateForm`
 * migrate onto `SchemaForm` without a v1→v2 manifest rewrite; also reusable
 * for Phase 1's own v1→v2 template manifest mapping if it hasn't built one.
 *
 * Pure — no React/Next imports.
 */
import type { JsonSchema } from '@/components/forms/schema-form/types'

export interface TemplateVariable {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  description?: string
  default?: string | number | boolean
  options?: Array<{ label: string; value: string }>
}

export interface LegacyVariablesConversion {
  schema: JsonSchema
  /** Default values matching the legacy `UseTemplateForm`'s useState initializer. */
  defaults: Record<string, string | number | boolean>
}

function variableToPropertySchema(variable: TemplateVariable): JsonSchema {
  const base: JsonSchema = {
    title: variable.key,
  }
  if (variable.description) base.description = variable.description
  if (variable.default !== undefined) base.default = variable.default

  switch (variable.type) {
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'number':
      return { ...base, type: 'number' }
    case 'select':
      return { ...base, type: 'string', enum: (variable.options ?? []).map((o) => o.value) }
    case 'multiselect':
      return {
        ...base,
        type: 'array',
        items: { type: 'string', enum: (variable.options ?? []).map((o) => o.value) },
      }
    case 'string':
    default:
      return { ...base, type: 'string' }
  }
}

/** Legacy default-value fallback, matching `UseTemplateForm`'s original useState initializer. */
function legacyDefault(variable: TemplateVariable): string | number | boolean {
  if (variable.default !== undefined) return variable.default
  if (variable.type === 'boolean') return false
  if (variable.type === 'number') return 0
  return ''
}

export function templateVariablesToJsonSchema(
  variables: TemplateVariable[],
): LegacyVariablesConversion {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const defaults: Record<string, string | number | boolean> = {}

  for (const variable of variables) {
    properties[variable.key] = variableToPropertySchema(variable)
    if (variable.required) required.push(variable.key)
    defaults[variable.key] = legacyDefault(variable)
  }

  return {
    schema: { type: 'object', properties, required },
    defaults,
  }
}
