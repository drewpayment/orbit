// orbit-www/src/lib/template-manifest.ts
import * as yaml from 'yaml'

export interface TemplateVariable {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
  required: boolean
  description?: string
  default?: string | number | boolean
  validation?: {
    pattern?: string
    minLength?: number
    maxLength?: number
    min?: number
    max?: number
  }
  options?: Array<{
    label: string
    value: string
  }>
}

export interface TemplateHook {
  command: string
  description?: string
  workingDir?: string
}

export interface TemplateManifest {
  apiVersion: string
  kind: 'Template'
  metadata: {
    name: string
    description?: string
    language: string
    framework?: string
    categories: string[]
    tags?: string[]
    complexity?: 'starter' | 'intermediate' | 'production-ready'
  }
  variables?: TemplateVariable[]
  hooks?: {
    postGeneration?: TemplateHook[]
  }
}

export interface ManifestValidationError {
  path: string
  message: string
}

/**
 * Parse and validate an orbit-template.yaml manifest
 */
export function parseManifest(content: string): {
  manifest: TemplateManifest | null
  errors: ManifestValidationError[]
} {
  const errors: ManifestValidationError[] = []

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch (e) {
    return {
      manifest: null,
      errors: [{ path: '', message: `Invalid YAML: ${e instanceof Error ? e.message : 'Unknown error'}` }],
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      manifest: null,
      errors: [{ path: '', message: 'Manifest must be an object' }],
    }
  }

  const doc = parsed as Record<string, unknown>

  // Validate apiVersion
  if (doc.apiVersion !== 'orbit/v1') {
    errors.push({ path: 'apiVersion', message: 'apiVersion must be "orbit/v1"' })
  }

  // Validate kind
  if (doc.kind !== 'Template') {
    errors.push({ path: 'kind', message: 'kind must be "Template"' })
  }

  // Validate metadata
  if (!doc.metadata || typeof doc.metadata !== 'object') {
    errors.push({ path: 'metadata', message: 'metadata is required' })
    return { manifest: null, errors }
  }

  const metadata = doc.metadata as Record<string, unknown>

  if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push({ path: 'metadata.name', message: 'name is required' })
  }

  if (!metadata.language || typeof metadata.language !== 'string') {
    errors.push({ path: 'metadata.language', message: 'language is required' })
  }

  if (!metadata.categories || !Array.isArray(metadata.categories) || metadata.categories.length === 0) {
    errors.push({ path: 'metadata.categories', message: 'categories must have at least one item' })
  }

  // Validate variables if present
  if (doc.variables && Array.isArray(doc.variables)) {
    doc.variables.forEach((v: unknown, index: number) => {
      if (!v || typeof v !== 'object') {
        errors.push({ path: `variables[${index}]`, message: 'Variable must be an object' })
        return
      }

      const variable = v as Record<string, unknown>

      if (!variable.key || typeof variable.key !== 'string') {
        errors.push({ path: `variables[${index}].key`, message: 'key is required' })
      }

      if (!variable.type || !['string', 'number', 'boolean', 'select', 'multiselect'].includes(variable.type as string)) {
        errors.push({ path: `variables[${index}].type`, message: 'type must be string, number, boolean, select, or multiselect' })
      }

      if (['select', 'multiselect'].includes(variable.type as string) && !Array.isArray(variable.options)) {
        errors.push({ path: `variables[${index}].options`, message: 'options required for select/multiselect type' })
      }
    })
  }

  if (errors.length > 0) {
    return { manifest: null, errors }
  }

  // Construct validated manifest
  const manifest: TemplateManifest = {
    apiVersion: doc.apiVersion as string,
    kind: 'Template',
    metadata: {
      name: metadata.name as string,
      description: metadata.description as string | undefined,
      language: metadata.language as string,
      framework: metadata.framework as string | undefined,
      categories: metadata.categories as string[],
      tags: metadata.tags as string[] | undefined,
      complexity: metadata.complexity as 'starter' | 'intermediate' | 'production-ready' | undefined,
    },
    variables: doc.variables as TemplateVariable[] | undefined,
    hooks: doc.hooks as { postGeneration?: TemplateHook[] } | undefined,
  }

  return { manifest, errors: [] }
}
