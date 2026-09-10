// orbit-www/src/lib/scaffolder/validate.ts
import Ajv from 'ajv'
import type { TemplateDefinition } from './schema'

/**
 * The action registry entry the TS validator needs. Served (Phase 1 task
 * 5.1/5.2) by the Go registry's `Descriptors()` over a small gRPC RPC
 * (`ListActions`), so the client-side/server-side validator can run against
 * the live set of actions without duplicating action definitions in TS.
 */
export interface ActionDescriptor {
  id: string
  family: string
  name: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  supportsPlan: boolean
}

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

/**
 * Extracts the well-known namespaces (`parameters`, `steps`, `user`,
 * `workspace`, `template`, `run`) plus a small filter chain per design §4.2 —
 * the TS validator only needs the dotted path, not the filters, since
 * filters don't change reference validity.
 */
const EXPRESSION_RE = /\$\{\{\s*([a-zA-Z_][\w.]*)(?:\s*\|[^}]*)?\s*\}\}/g
const WHOLE_EXPRESSION_RE = /^\$\{\{\s*[a-zA-Z_][\w.]*(?:\s*\|[^}]*)?\s*\}\}$/

/** Recursively walk a value (string/array/object) collecting every `${{ path }}` reference. */
function collectExpressionPaths(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const re = new RegExp(EXPRESSION_RE)
    let match: RegExpExecArray | null
    while ((match = re.exec(value))) {
      out.add(match[1])
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectExpressionPaths(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectExpressionPaths(v, out)
  }
  return out
}

/** True when the whole string value is a single expression (not embedded in other text). */
function isExpressionOnly(value: unknown): value is string {
  return typeof value === 'string' && WHOLE_EXPRESSION_RE.test(value)
}

/**
 * Static validator for a v2 template definition (phase-1 plan §3.2). Pure and
 * synchronous; collects every error rather than failing fast so the authoring
 * UI (Phase 2) can surface them all at once. Checks:
 *
 *  1. Step ids are unique.
 *  2. Every `${{ }}` expression resolves: `steps.X.*` references an EARLIER
 *     step (array order; no forward/self refs) whose action declares that
 *     output key; `parameters.X` exists on some page; `user.*`, `workspace.*`,
 *     `template.*`, `run.id` are always allowed.
 *  3. Every step's `action` exists in the registry.
 *  4. Every non-expression (literal) `input` field validates against that
 *     action's InputSchema via ajv.
 */
export function validateDefinition(
  def: TemplateDefinition,
  registry: ActionDescriptor[],
): ValidationResult {
  const errors: ValidationError[] = []
  const registryById = new Map(registry.map((a) => [a.id, a]))
  const ajv = new Ajv({ allErrors: true, strict: false })

  // Check 1: unique step ids.
  const seenIds = new Set<string>()
  for (const [i, step] of def.spec.steps.entries()) {
    if (seenIds.has(step.id)) {
      errors.push({ path: `spec.steps[${i}].id`, message: `Duplicate step id "${step.id}"` })
    }
    seenIds.add(step.id)
  }

  const knownParams = new Set<string>()
  for (const page of def.spec.parameters) {
    for (const key of Object.keys(page.properties)) knownParams.add(key)
  }

  const stepIndexById = new Map(def.spec.steps.map((s, i) => [s.id, i]))

  const validateExpressionPath = (path: string, stepIndex: number, stepPath: string) => {
    if (
      path === 'run.id' ||
      path.startsWith('user.') ||
      path.startsWith('workspace.') ||
      path.startsWith('template.')
    ) {
      return
    }

    if (path.startsWith('parameters.')) {
      const key = path.slice('parameters.'.length)
      if (!knownParams.has(key)) {
        errors.push({ path: stepPath, message: `Unknown parameter reference "${path}"` })
      }
      return
    }

    if (path.startsWith('steps.')) {
      const parts = path.split('.')
      const refId = parts[1]
      const refIndex = stepIndexById.get(refId)
      if (refIndex === undefined) {
        errors.push({ path: stepPath, message: `Reference to unknown step "${refId}" in "${path}"` })
        return
      }
      if (refIndex >= stepIndex) {
        errors.push({
          path: stepPath,
          message: `Step "${refId}" is not an earlier step (forward/self reference) in "${path}"`,
        })
        return
      }
      if (parts[2] !== 'output') {
        errors.push({ path: stepPath, message: `Expected "steps.${refId}.output.*", got "${path}"` })
        return
      }
      const outputKey = parts[3]
      const refDescriptor = registryById.get(def.spec.steps[refIndex].action)
      if (refDescriptor && outputKey) {
        const props = (refDescriptor.outputSchema?.properties ?? {}) as Record<string, unknown>
        if (!(outputKey in props)) {
          errors.push({
            path: stepPath,
            message: `Step "${refId}"'s action "${refDescriptor.id}" has no output "${outputKey}"`,
          })
        }
      }
      return
    }

    errors.push({ path: stepPath, message: `Unknown expression namespace in "${path}"` })
  }

  def.spec.steps.forEach((step, i) => {
    const stepPath = `spec.steps[${i}]`

    // Check 3: action exists.
    const descriptor = registryById.get(step.action)
    if (!descriptor) {
      errors.push({ path: `${stepPath}.action`, message: `Unknown action "${step.action}"` })
    }

    // Check 2: expression references in `if` and `input`.
    for (const path of collectExpressionPaths(step.if)) validateExpressionPath(path, i, stepPath)
    for (const path of collectExpressionPaths(step.input)) validateExpressionPath(path, i, stepPath)

    // Check 4: literal (non-expression) input fields against the action's InputSchema.
    if (descriptor) {
      const props = (descriptor.inputSchema?.properties ?? {}) as Record<string, unknown>
      for (const [key, value] of Object.entries(step.input)) {
        if (isExpressionOnly(value)) continue
        const propSchema = props[key]
        if (!propSchema || typeof propSchema !== 'object') continue
        const validateProp = ajv.compile(propSchema as object)
        if (!validateProp(value)) {
          for (const err of validateProp.errors ?? []) {
            errors.push({
              path: `${stepPath}.input.${key}`,
              message: err.message ?? `invalid value for "${key}"`,
            })
          }
        }
      }
    }
  })

  // Also check expression references inside spec.output (link urls/entity/text).
  if (def.spec.output) {
    for (const path of collectExpressionPaths(def.spec.output)) {
      validateExpressionPath(path, def.spec.steps.length, 'spec.output')
    }
  }

  return { ok: errors.length === 0, errors }
}
