/**
 * Pure helpers for `StepsBuilder` (Task 11): registry grouping, step id
 * generation, and dependent-step discovery for the remove-step confirmation.
 * Kept framework-free so they're unit-testable without React.
 */
import type { ActionDescriptor } from '@/lib/scaffolder/validate'
import type { TemplateDefinition } from '@/lib/scaffolder/schema'

/** Group the action registry by `family`, preserving registry order within each group. */
export function groupRegistryByFamily(registry: ActionDescriptor[]): Map<string, ActionDescriptor[]> {
  const groups = new Map<string, ActionDescriptor[]>()
  for (const descriptor of registry) {
    const existing = groups.get(descriptor.family)
    if (existing) {
      existing.push(descriptor)
    } else {
      groups.set(descriptor.family, [descriptor])
    }
  }
  return groups
}

/** Legal `${{ steps.<id>.output.* }}` path segment (mirrors `schema.ts`'s `StepSchema.id`). */
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]*$/

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return STEP_ID_PATTERN.test(slug) ? slug : slug.replace(/^[^a-z]+/, '') || 'step'
}

/**
 * Generate a unique, legal step id derived from an action id (e.g.
 * `github:repo:create-from-template` → `create-from-template`), avoiding
 * collisions with `existingIds` by appending `-2`, `-3`, …
 */
export function generateStepId(existingIds: string[], actionId: string): string {
  const lastSegment = actionId.split(/[:/]/).pop() ?? actionId
  const base = slugify(lastSegment) || 'step'
  const taken = new Set(existingIds)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Default `input` for a freshly added step, keyed by action id
 * (Template Authoring Phase 4, Task E). A `catalog:entity:register` step
 * gets its template-provenance fields for free — `${{ template.id }}` and
 * `${{ template.versionId }}` are always resolvable (seeded by
 * `scaffolder_workflow.go`'s `newScaffolderRun`, no engine change needed) so
 * an entity a template scaffolds is automatically traceable back to it,
 * which is what the golden-path-provenance scorecard check reads. Every
 * other action still gets an empty input, same as before this default was
 * introduced.
 */
export function defaultStepInput(actionId: string): Record<string, unknown> {
  if (actionId === 'catalog:entity:register') {
    return {
      templateDefinitionId: '${{ template.id }}',
      templateVersionId: '${{ template.versionId }}',
    }
  }
  return {}
}

/** One place elsewhere in the definition that references a step's id via `${{ steps.<id>... }}`. */
export interface StepReference {
  /** The referencing step's id, or `'__output__'` for `spec.output`. */
  sourceId: string
  /** Human-readable label for the confirm dialog (step name, or "Output"). */
  sourceLabel: string
}

const PATH_SEGMENT = '[A-Za-z_][A-Za-z0-9_-]*'
const EXPRESSION_RE = new RegExp(`\\$\\{\\{\\s*(${PATH_SEGMENT}(?:\\.${PATH_SEGMENT})*)`, 'g')

/** Recursively walk a value (string/array/object) collecting every `${{ path` reference prefix. */
function collectExpressionPaths(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const re = new RegExp(EXPRESSION_RE)
    let match: RegExpExecArray | null
    while ((match = re.exec(value))) out.add(match[1])
  } else if (Array.isArray(value)) {
    for (const v of value) collectExpressionPaths(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectExpressionPaths(v, out)
  }
}

/**
 * Find every other step (and `spec.output`) that references `stepId` via
 * `${{ steps.<stepId>.output... }}` — used by `StepsBuilder` to warn before
 * removing a step whose output other steps depend on, rather than silently
 * orphaning those references (the static validator, `lib/scaffolder/
 * validate.ts`, will catch the resulting dangling reference on next
 * validate/save, but a warning at the point of deletion is cheaper to act on).
 */
export function findStepReferences(definition: TemplateDefinition, stepId: string): StepReference[] {
  const prefix = `steps.${stepId}.`
  const refs: StepReference[] = []

  for (const step of definition.spec.steps) {
    if (step.id === stepId) continue
    const paths = new Set<string>()
    collectExpressionPaths(step.input, paths)
    if (step.if) collectExpressionPaths(step.if, paths)
    if ([...paths].some((p) => p.startsWith(prefix))) {
      refs.push({ sourceId: step.id, sourceLabel: step.name })
    }
  }

  if (definition.spec.output) {
    const paths = new Set<string>()
    collectExpressionPaths(definition.spec.output, paths)
    if ([...paths].some((p) => p.startsWith(prefix))) {
      refs.push({ sourceId: '__output__', sourceLabel: 'Output' })
    }
  }

  return refs
}
