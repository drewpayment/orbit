/**
 * `applyParameterDefaults` — the single TypeScript implementation of JSON
 * Schema `default` application for scaffolder template parameters. Mirrors
 * `temporal-workflows/internal/scaffolder/defaults.go`'s
 * `ApplyParameterDefaults` byte-for-byte in semantics (see that file's doc
 * comment) so a form submitted through `SchemaForm`, a value validated and
 * persisted by the authoring server actions, and a value the Go workflow
 * resolves an expression against all agree on what "the parameters" are.
 *
 * Deliberately decoupled from any one page/schema type (`SchemaFormPage`,
 * the persisted `ParameterPage` in `schema.ts`, …) — both shapes are plain
 * `{ properties: { [name]: { type?, default?, properties? } } }` objects, so
 * either can be passed in directly without an adapter.
 */
import { evaluateVisibleIf } from './visible-if'

/** The subset of a JSON Schema property this module needs. */
export interface DefaultableProperty {
  type?: string
  default?: unknown
  properties?: Record<string, DefaultableProperty>
  /**
   * The wire format's inline `ui:visibleIf` (design §3.1: `ui:*` keys live
   * directly on the property object, e.g.
   * `{ type: 'string', 'ui:visibleIf': '${{ parameters.foo }}' }`). Only
   * consulted for a TOP-LEVEL property whose `default` this module itself
   * just filled in — see `applyParameterDefaults`'s doc comment.
   */
  'ui:visibleIf'?: string
}

/** The subset of a parameter page this module needs. */
export interface DefaultableParameterPage {
  properties?: Record<string, DefaultableProperty>
}

/**
 * Fills in each parameter page's declared JSON Schema `default` for any key
 * absent from `params`, then drops any TOP-LEVEL key this pass itself just
 * defaulted whose `ui:visibleIf` evaluates false against the fully-defaulted
 * result — a hidden field's default must never leak into a caller's
 * output, matching what `SchemaForm` already does for its own submit path
 * (`stripHiddenFieldValues`). Returns the result; never mutates `params`,
 * including any nested object value inside it.
 *
 * A key already present in `params` always wins, including an explicit
 * `false`/`''`/`0`: only *absence* of the key counts as "not provided" (and
 * so eligible to be filled AND drop-checked). A property with no declared
 * `default` is left absent rather than invented. An `object`-typed property
 * with its own nested `properties` is filled recursively — a free-form
 * `{ key: value }` map (no `properties`) is left alone, matching
 * `SchemaForm`'s own `isKeyValueObjectSchema` distinction. `ui:visibleIf`
 * is deliberately only checked at the top level, matching the vocabulary's
 * existing scope (nested object properties don't carry `ui:*` directives
 * today — see `SchemaForm`'s "KNOWN LIMITATION" doc comment).
 *
 * Note: only a value THIS CALL defaulted is drop-checked — a value the
 * caller explicitly provided for a currently-hidden field is left alone;
 * whether an explicit-but-hidden value should ever reach persistence is a
 * separate, pre-existing concern (`stripHiddenFieldValues` at SchemaForm's
 * own submit time, and `validateRunParameters`'s visibleIf-aware `required`
 * filtering server-side) that this module does not change.
 */
export function applyParameterDefaults(
  pages: DefaultableParameterPage[],
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params }
  const newlyDefaulted = new Map<string, DefaultableProperty>()
  for (const page of pages) {
    fillPageDefaults(page.properties ?? {}, out, newlyDefaulted)
  }
  for (const [name, prop] of newlyDefaulted) {
    const visibleIf = prop['ui:visibleIf']
    if (typeof visibleIf === 'string' && !evaluateVisibleIf(visibleIf, out)) {
      delete out[name]
    }
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Fills `out` from `properties`' declared defaults. `record`, when
 * non-null, collects every TOP-LEVEL property this call defaults (name →
 * its schema, so its `ui:visibleIf` can be checked once every page has been
 * filled) — callers pass `null` for a nested recursive fill, since
 * `ui:visibleIf` has no meaning below the top level.
 */
function fillPageDefaults(
  properties: Record<string, DefaultableProperty>,
  out: Record<string, unknown>,
  record: Map<string, DefaultableProperty> | null,
): void {
  for (const [name, prop] of Object.entries(properties)) {
    const hasNestedProperties = prop.type === 'object' && !!prop.properties && Object.keys(prop.properties).length > 0
    const provided = Object.prototype.hasOwnProperty.call(out, name)

    if (!provided) {
      if ('default' in prop) {
        out[name] = prop.default
        record?.set(name, prop)
        continue
      }
      if (hasNestedProperties) {
        const nested: Record<string, unknown> = {}
        fillPageDefaults(prop.properties!, nested, null)
        if (Object.keys(nested).length > 0) out[name] = nested
      }
      continue
    }

    if (hasNestedProperties && isPlainObject(out[name])) {
      // Copy before filling — `out[name]` may be the caller's own nested
      // object (params was only shallow-copied one level up), so filling it
      // in place would leak defaults into the caller's object for any key
      // it left unset.
      const nestedCopy = { ...(out[name] as Record<string, unknown>) }
      fillPageDefaults(prop.properties!, nestedCopy, null)
      out[name] = nestedCopy
    }
  }
}
