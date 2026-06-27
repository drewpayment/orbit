import type { AutomationEvent } from './events'
import { getEventPath } from './match'

/**
 * Input-mapping resolution (IDP refocus P4) — pure, fully unit-tested.
 *
 * An automation's `inputMapping` maps action-input keys → values that may
 * reference the triggering event with `{{dotted.path}}` templates. Two modes:
 *   - whole-value template (`"{{passed}}"`): the source value is substituted
 *     RAW, preserving its type (boolean/number/object), or `undefined` if the
 *     path is missing — so a boolean input stays a boolean.
 *   - mixed text (`"Rule {{rule.title}} failing"`): each template is replaced by
 *     its string form (missing → ''), producing a string.
 * Non-string mapping values pass through unchanged.
 *
 * The resolved object is later validated against the Action's inputSchema by the
 * dispatcher (reusing the P3 validator), so this layer does no schema work.
 */

/** Matches a single template token, capturing the inner (trimmed) path. */
const TEMPLATE = /\{\{\s*([^}]+?)\s*\}\}/g

/** True if the whole string is exactly one template token. */
function isWholeTemplate(s: string): boolean {
  const m = s.match(/^\{\{\s*([^}]+?)\s*\}\}$/)
  return m != null
}

function wholeTemplatePath(s: string): string {
  return s.replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Resolve an `inputMapping` against an event into a plain inputs object.
 * Returns `{}` when the mapping isn't a plain object.
 */
export function resolveInputMapping(
  mapping: unknown,
  event: AutomationEvent,
): Record<string, unknown> {
  if (!isRecord(mapping)) return {}

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value !== 'string') {
      out[key] = value
      continue
    }
    if (isWholeTemplate(value)) {
      // Preserve the source type (boolean/number/object/undefined).
      out[key] = getEventPath(event, wholeTemplatePath(value))
      continue
    }
    // Mixed text → string interpolation; missing paths render empty.
    out[key] = value.replace(TEMPLATE, (_, path: string) => {
      const v = getEventPath(event, path.trim())
      return v == null ? '' : String(v)
    })
  }
  return out
}
