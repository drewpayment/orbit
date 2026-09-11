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

/** The subset of a JSON Schema property this module needs. */
export interface DefaultableProperty {
  type?: string
  default?: unknown
  properties?: Record<string, DefaultableProperty>
}

/** The subset of a parameter page this module needs. */
export interface DefaultableParameterPage {
  properties?: Record<string, DefaultableProperty>
}

/**
 * Fills in each parameter page's declared JSON Schema `default` for any key
 * absent from `params`, and returns the result — it never mutates `params`,
 * including any nested object value inside it.
 *
 * A key already present in `params` always wins, including an explicit
 * `false`/`''`/`0`: only *absence* of the key counts as "not provided". A
 * property with no declared `default` is left absent rather than invented.
 * An `object`-typed property with its own nested `properties` is filled
 * recursively — a free-form `{ key: value }` map (no `properties`) is left
 * alone, matching `SchemaForm`'s own `isKeyValueObjectSchema` distinction.
 */
export function applyParameterDefaults(
  pages: DefaultableParameterPage[],
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params }
  for (const page of pages) {
    applyPageDefaults(page.properties ?? {}, out)
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function applyPageDefaults(
  properties: Record<string, DefaultableProperty>,
  out: Record<string, unknown>,
): void {
  for (const [name, prop] of Object.entries(properties)) {
    const hasNestedProperties = prop.type === 'object' && !!prop.properties && Object.keys(prop.properties).length > 0
    const provided = Object.prototype.hasOwnProperty.call(out, name)

    if (!provided) {
      if ('default' in prop) {
        out[name] = prop.default
        continue
      }
      if (hasNestedProperties) {
        const nested: Record<string, unknown> = {}
        applyPageDefaults(prop.properties!, nested)
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
      applyPageDefaults(prop.properties!, nestedCopy)
      out[name] = nestedCopy
    }
  }
}
