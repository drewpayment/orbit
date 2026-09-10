// orbit-www/src/lib/scaffolder/v1-migration.ts
import type { TemplateManifest, TemplateVariable } from '@/lib/template-manifest'
import type { Template } from '@/payload-types'
import type { TemplateDefinition } from './schema'

/**
 * Pure v1 → v2 mapping (phase-1 plan §7/9.1). No I/O — the caller
 * (`scripts/migrate-templates-to-v2.ts`) is responsible for reading the
 * source `templates` row + parsed manifest and writing the result.
 *
 * Mirrors `template_instantiation_workflow.go:159`'s branch on
 * `isGitHubTemplate`: the fast path uses
 * `github:repo:create-from-template`; otherwise the four explicit steps
 * (`github:repo:create` → `fetch:git` → `fs:render` → `git:push`) that
 * reproduce the same clone/apply-vars/push flow.
 *
 * `catalog:entity:register` is always appended as the final step — v1's
 * `FinalizeInstantiation` never actually registered a catalog entity (it was
 * a stub), so this is the one intentional behaviour addition the migration
 * makes. Call this out explicitly wherever this mapping is used (PR body,
 * parity check).
 */
export function mapV1TemplateToV2Definition(
  template: Template,
  manifest: TemplateManifest,
): TemplateDefinition {
  const parameterPage = variablesToParameterPage(manifest.variables ?? [])

  const steps: TemplateDefinition['spec']['steps'] = template.isGitHubTemplate
    ? [
        {
          id: 'repo',
          name: 'Create repository from template',
          action: 'github:repo:create-from-template',
          input: {
            repoUrl: template.repoUrl,
            defaultBranch: template.defaultBranch ?? 'main',
            name: variableExpr(parameterPage, 'name') ?? '${{ parameters.serviceName }}',
          },
        },
      ]
    : [
        {
          id: 'repo',
          name: 'Create repository',
          action: 'github:repo:create',
          input: {
            name: variableExpr(parameterPage, 'name') ?? '${{ parameters.serviceName }}',
          },
        },
        {
          id: 'fetch',
          name: 'Clone template repository',
          action: 'fetch:git',
          input: { repoUrl: template.repoUrl, ref: template.defaultBranch ?? 'main' },
        },
        {
          id: 'render',
          name: 'Apply template variables',
          action: 'fs:render',
          input: { source: '${{ steps.fetch.output.checkout }}' },
        },
        {
          id: 'push',
          name: 'Push rendered content',
          action: 'git:push',
          input: {
            repo: '${{ steps.repo.output.repoUrl }}',
            path: '${{ steps.render.output.path }}',
          },
        },
      ]

  steps.push({
    id: 'catalog',
    name: 'Register catalog entity',
    action: 'catalog:entity:register',
    input: {
      kind: manifest.metadata.categories?.[0] ?? 'service',
      name: variableExpr(parameterPage, 'name') ?? '${{ parameters.serviceName }}',
      source: { type: 'template', sourceId: template.id },
      links: [{ title: 'Repository', url: '${{ steps.repo.output.repoUrl }}' }],
    },
  })

  return {
    apiVersion: 'orbit/v2',
    kind: 'Template',
    metadata: {
      name: manifest.metadata.name,
      title: template.name,
      description: template.description ?? manifest.metadata.description,
      tags: manifest.metadata.tags,
      owner: template.gitProvider,
      targetKind: manifest.metadata.categories?.[0],
    },
    spec: {
      parameters: [parameterPage],
      steps,
    },
  }
}

/**
 * Maps v1's flat `variables[]` (one entry per form field) onto a single v2
 * parameters page, one JSON-Schema property per variable — select becomes
 * `enum`, multiselect becomes an array of `enum`, `validation` maps onto the
 * matching JSON-Schema keywords.
 */
function variablesToParameterPage(variables: TemplateVariable[]): TemplateDefinition['spec']['parameters'][number] {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const v of variables) {
    properties[v.key] = variableToJsonSchemaProperty(v)
    if (v.required) required.push(v.key)
  }

  return {
    title: 'Variables',
    ...(required.length > 0 ? { required } : {}),
    properties,
  }
}

function variableToJsonSchemaProperty(v: TemplateVariable): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  if (v.description) base['ui:help'] = v.description
  if (v.default !== undefined) base.default = v.default

  switch (v.type) {
    case 'string':
      return {
        type: 'string',
        ...(v.validation?.pattern ? { pattern: v.validation.pattern } : {}),
        ...(v.validation?.minLength !== undefined ? { minLength: v.validation.minLength } : {}),
        ...(v.validation?.maxLength !== undefined ? { maxLength: v.validation.maxLength } : {}),
        ...base,
      }
    case 'number':
      return {
        type: 'number',
        ...(v.validation?.min !== undefined ? { minimum: v.validation.min } : {}),
        ...(v.validation?.max !== undefined ? { maximum: v.validation.max } : {}),
        ...base,
      }
    case 'boolean':
      return { type: 'boolean', ...base }
    case 'select':
      return { type: 'string', enum: (v.options ?? []).map((o) => o.value), ...base }
    case 'multiselect':
      return {
        type: 'array',
        items: { enum: (v.options ?? []).map((o) => o.value) },
        ...base,
      }
    default:
      return { type: 'string', ...base }
  }
}

/** Best-effort lookup: does the parameter page have a "name"-ish key we can reference by exact key? */
function variableExpr(
  page: TemplateDefinition['spec']['parameters'][number],
  hint: 'name',
): string | undefined {
  if (hint === 'name' && 'name' in page.properties) return '${{ parameters.name }}'
  return undefined
}
