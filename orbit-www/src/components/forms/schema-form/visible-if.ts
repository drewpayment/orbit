/**
 * `ui:visibleIf` expression evaluator.
 *
 * Parses a small subset of the `${{ }}` expression language against a flat
 * `parameters.*` value bag: a bare field reference (`parameters.foo`,
 * truthy check), negation (`!parameters.foo`), and equality
 * (`parameters.foo == 'bar'` / `parameters.foo == 3`).
 *
 * Two deliberate choices, both documented per the Phase 2 plan:
 *  - A referenced field that is **missing** from `values` defaults to
 *    **hidden** (`false`) — an author who references a not-yet-filled field
 *    should see the field stay hidden until its dependency has a value.
 *  - A **malformed** expression fails **open** (`true`, visible) — a typo in
 *    an expression should never silently lock an author/consumer out of a
 *    field with no way to reach it.
 *
 * This is intentionally reused (not forked) for the Phase 2 step-input
 * expression-preview panel — keep this the one parser for `${{ }}` truthy /
 * equality checks.
 */

const WRAPPER_RE = /^\$\{\{\s*(.*?)\s*\}\}$/

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'number') return value !== 0
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function resolveRef(ref: string, values: Record<string, unknown>): { found: boolean; value: unknown } {
  // Only `parameters.<name>` refs are supported today.
  const match = /^parameters\.([A-Za-z0-9_.]+)$/.exec(ref)
  if (!match) return { found: false, value: undefined }
  const path = match[1].split('.')
  let current: unknown = values
  for (const segment of path) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return { found: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

function parseLiteral(raw: string): { ok: true; value: string | number | boolean } | { ok: false } {
  const trimmed = raw.trim()
  if (trimmed === 'true') return { ok: true, value: true }
  if (trimmed === 'false') return { ok: true, value: false }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: true, value: Number(trimmed) }
  const quoted = /^'([^']*)'$/.exec(trimmed) ?? /^"([^"]*)"$/.exec(trimmed)
  if (quoted) return { ok: true, value: quoted[1] }
  return { ok: false }
}

/**
 * Evaluate a `ui:visibleIf` expression against the current form values.
 * `values` is the flat parameters bag (unprefixed field names → values).
 */
export function evaluateVisibleIf(
  expression: string | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!expression) return true

  const match = WRAPPER_RE.exec(expression.trim())
  if (!match) return true // malformed wrapper — fail open

  const body = match[1].trim()
  if (!body) return true

  // Negation: !parameters.foo
  if (body.startsWith('!')) {
    const inner = body.slice(1).trim()
    const { found, value } = resolveRef(inner, values)
    if (!found) return true // can't resolve → fail open (not a missing-field case)
    return !isTruthy(value)
  }

  // Equality: parameters.foo == 'bar' | parameters.foo == 3
  const eqMatch = /^(.+?)==(.+)$/.exec(body)
  if (eqMatch) {
    const [, lhsRaw, rhsRaw] = eqMatch
    const literal = parseLiteral(rhsRaw)
    if (!literal.ok) return true // right-hand side isn't a recognizable literal → malformed, fail open
    const { found, value } = resolveRef(lhsRaw.trim(), values)
    if (!found) return false // missing referenced field → hidden
    return value === literal.value
  }

  // Bare truthy reference: parameters.foo
  const { found, value } = resolveRef(body, values)
  if (!found) {
    // Not a recognizable `parameters.*` reference at all → malformed, fail open.
    if (!/^parameters\./.test(body)) return true
    // A `parameters.*` reference whose field is simply absent → hidden.
    return false
  }
  return isTruthy(value)
}
