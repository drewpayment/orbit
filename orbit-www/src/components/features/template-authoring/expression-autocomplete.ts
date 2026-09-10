/**
 * Expression autocomplete candidates for step inputs — Template Authoring
 * Phase 2, Task 11. Pure, framework-free: given the current builder state, a
 * step index, and the action registry, returns the `${{ }}` paths available
 * at that step — `parameters.*` (from all parameter pages) and
 * `steps.<earlier-id>.output.*` (walked from EARLIER steps' registry-declared
 * output schemas only; the step's own id and any later step are excluded, so
 * an author is never offered a forward/self reference the validator would
 * reject — see `lib/scaffolder/validate.ts`'s `validateExpressionPath`).
 */
import type { TemplateDefinition } from '@/lib/scaffolder/schema'
import type { ActionDescriptor } from '@/lib/scaffolder/validate'
import type { JsonSchema } from '@/components/forms/schema-form/types'

export interface ExpressionCandidate {
  /** Full dotted path, without the `${{ }}` wrapper, e.g. `parameters.name`. */
  path: string
  /** Short description for the autocomplete UI (field title, step name, …). */
  description?: string
}

function walkLeafPaths(schema: JsonSchema | undefined, prefix: string, out: ExpressionCandidate[]): void {
  if (!schema) return
  const properties = schema.properties
  if (schema.type === 'object' && properties && Object.keys(properties).length > 0) {
    for (const [name, propSchema] of Object.entries(properties)) {
      walkLeafPaths(propSchema, `${prefix}.${name}`, out)
    }
    return
  }
  out.push({ path: prefix, description: schema.title ?? schema.type })
}

/**
 * Candidates available for the step at `stepIndex` in `definition.spec.steps`
 * (array order defines "earlier"). `registry` supplies each earlier step's
 * action's declared `outputSchema`.
 */
export function getExpressionCandidates(
  definition: TemplateDefinition,
  stepIndex: number,
  registry: ActionDescriptor[],
): ExpressionCandidate[] {
  const candidates: ExpressionCandidate[] = []
  const registryById = new Map(registry.map((a) => [a.id, a]))

  for (const page of definition.spec.parameters) {
    for (const [name, property] of Object.entries(page.properties)) {
      candidates.push({
        path: `parameters.${name}`,
        description: (property as { title?: string }).title ?? page.title,
      })
    }
  }

  definition.spec.steps.forEach((step, i) => {
    if (i >= stepIndex) return // exclude self and later steps
    const descriptor = registryById.get(step.action)
    if (!descriptor) return
    const outputSchema = descriptor.outputSchema as JsonSchema | undefined
    const leaves: ExpressionCandidate[] = []
    walkLeafPaths(outputSchema, `steps.${step.id}.output`, leaves)
    for (const leaf of leaves) {
      candidates.push({ path: leaf.path, description: leaf.description ?? step.name })
    }
  })

  return candidates
}
