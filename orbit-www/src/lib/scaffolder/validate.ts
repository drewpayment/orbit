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
 *
 * Each path segment is `[A-Za-z_][A-Za-z0-9_-]*` — this MUST stay aligned
 * with the Go grammar (`temporal-workflows/internal/scaffolder/expr.go`) and
 * with `StepSchema`'s id pattern (`^[a-z][a-z0-9-]*$`, schema.ts): a step id
 * may contain hyphens (`create-repo`), and `steps.create-repo.output.x` must
 * be recognized as a reference, not silently dropped because `\w` excludes
 * `-`.
 */
const PATH_SEGMENT = '[A-Za-z_][A-Za-z0-9_-]*'
const PATH_PATTERN = `${PATH_SEGMENT}(?:\\.${PATH_SEGMENT})*`
const EXPRESSION_RE = new RegExp(`\\$\\{\\{\\s*(${PATH_PATTERN})(?:\\s*\\|[^}]*)?\\s*\\}\\}`, 'g')
const WHOLE_EXPRESSION_RE = new RegExp(`^\\$\\{\\{\\s*${PATH_PATTERN}(?:\\s*\\|[^}]*)?\\s*\\}\\}$`)

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

/** True when `value` is, or anywhere contains, an expression-only string leaf. */
function containsExpressionHole(value: unknown): boolean {
  if (isExpressionOnly(value)) return true
  if (Array.isArray(value)) return value.some(containsExpressionHole)
  if (value && typeof value === 'object') return Object.values(value).some(containsExpressionHole)
  return false
}

/**
 * Validates `value` against `schema`, treating any expression-only string —
 * however deeply nested inside objects/arrays — as a hole that always
 * passes, rather than a literal to type-check. Recurses through
 * `type: 'object'` (via `properties`) and `type: 'array'` (via a singular
 * `items` schema) so an expression nested inside an array of objects (e.g.
 * `{ items: [{ count: "${{ parameters.n }}" }] }`) is skipped at the leaf,
 * not smuggled whole into ajv where it would fail the leaf's declared type.
 * Falls back to skipping (not validating) any structure ajv can't be safely
 * pointed at without risking that false positive.
 */
function validateValueAgainstSchema(
  ajv: Ajv,
  value: unknown,
  schema: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (isExpressionOnly(value)) return
  if (!schema || typeof schema !== 'object') return
  const s = schema as { type?: string; properties?: Record<string, unknown>; items?: unknown }

  if (Array.isArray(value) && s.type === 'array' && s.items && typeof s.items === 'object' && !Array.isArray(s.items)) {
    value.forEach((item, idx) => validateValueAgainstSchema(ajv, item, s.items, `${path}[${idx}]`, errors))
    return
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    s.type === 'object' &&
    s.properties &&
    typeof s.properties === 'object'
  ) {
    for (const [key, propValue] of Object.entries(value as Record<string, unknown>)) {
      if (key in s.properties) {
        validateValueAgainstSchema(ajv, propValue, s.properties[key], `${path}.${key}`, errors)
      }
    }
    return
  }

  // Leaf, or a compound value we don't have enough schema structure to
  // recurse into safely. If it contains an expression hole anywhere, we
  // can't validate it without a false positive — skip rather than guess.
  if (containsExpressionHole(value)) return

  const validateFn = ajv.compile(schema as object)
  if (!validateFn(value)) {
    for (const err of validateFn.errors ?? []) {
      errors.push({ path, message: err.message ?? `invalid value at ${path}` })
    }
  }
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

  // Check 0: at least one step. The Go engine refuses to plan or execute a
  // stepless definition ("a template must declare at least one step"), so
  // surface it here instead of letting "Validation passed" precede a failed
  // dry run.
  if (def.spec.steps.length === 0) {
    errors.push({ path: 'spec.steps', message: 'A template must declare at least one step' })
  }

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

    // Check 2: expression references in `if` and `input`. `if` is evaluated
    // in a whole-expression boolean context (design §4.1/§6.1, Go's
    // EvalBool) — it must be EXACTLY one `${{ }}` expression, no surrounding
    // literal text and no multiple expressions concatenated.
    if (step.if !== undefined) {
      if (!isExpressionOnly(step.if)) {
        errors.push({
          path: `${stepPath}.if`,
          message:
            'step "if" must be exactly one whole expression (e.g. "${{ parameters.x }}") — ' +
            'no surrounding text and no multiple expressions',
        })
      } else {
        for (const path of collectExpressionPaths(step.if)) validateExpressionPath(path, i, stepPath)
      }
    }
    for (const path of collectExpressionPaths(step.input)) validateExpressionPath(path, i, stepPath)

    // Check 4: literal (non-expression) input fields against the action's
    // InputSchema — expression holes are skipped at whatever depth they
    // occur, not just at the top level.
    if (descriptor) {
      const props = (descriptor.inputSchema?.properties ?? {}) as Record<string, unknown>
      for (const [key, value] of Object.entries(step.input)) {
        const propSchema = props[key]
        if (!propSchema || typeof propSchema !== 'object') continue
        validateValueAgainstSchema(ajv, value, propSchema, `${stepPath}.input.${key}`, errors)
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
