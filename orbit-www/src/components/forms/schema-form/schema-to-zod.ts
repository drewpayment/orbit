/**
 * JSON Schema (draft 2020-12 SUBSET, see `types.ts`) → zod converter.
 *
 * Pure, no React/Next imports — safe to call from both the `SchemaForm`
 * client component and any server-side re-validation. `oneOf`/`anyOf`/`$ref`
 * (and `allOf`) are explicitly unsupported: rather than silently converting
 * them wrong (e.g. dropping the constraint), we throw
 * {@link UnsupportedSchemaError} with a field-path-aware message.
 */
import * as z from 'zod'
import { UnsupportedSchemaError, type JsonSchema } from './types'

function assertSupported(schema: JsonSchema, path: string): void {
  if (schema.oneOf) {
    throw new UnsupportedSchemaError(
      `Unsupported "oneOf" at "${path}" — SchemaForm does not support oneOf/anyOf/$ref unions.`,
    )
  }
  if (schema.anyOf) {
    throw new UnsupportedSchemaError(
      `Unsupported "anyOf" at "${path}" — SchemaForm does not support oneOf/anyOf/$ref unions.`,
    )
  }
  if (schema.allOf) {
    throw new UnsupportedSchemaError(
      `Unsupported "allOf" at "${path}" — SchemaForm does not support schema composition.`,
    )
  }
  if (schema.$ref) {
    throw new UnsupportedSchemaError(
      `Unsupported "$ref" at "${path}" — SchemaForm does not resolve $ref pointers.`,
    )
  }
}

function stringSchema(schema: JsonSchema): z.ZodTypeAny {
  let s = z.string()
  if (typeof schema.minLength === 'number') s = s.min(schema.minLength)
  if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength)
  if (schema.pattern) s = s.regex(new RegExp(schema.pattern))
  if (schema.format === 'email') s = s.email()
  if (schema.format === 'uri') s = s.url()

  let out: z.ZodTypeAny = s
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.map(String) as [string, ...string[]]
    out = z.enum(values)
  }
  return out
}

function numberSchema(schema: JsonSchema): z.ZodTypeAny {
  let s = z.number()
  if (schema.type === 'integer') s = s.int()
  if (typeof schema.minimum === 'number') s = s.min(schema.minimum)
  if (typeof schema.maximum === 'number') s = s.max(schema.maximum)
  if (typeof schema.multipleOf === 'number') s = s.multipleOf(schema.multipleOf)
  return s
}

function arraySchema(schema: JsonSchema, path: string): z.ZodTypeAny {
  const itemSchema = schema.items ? convert(schema.items, `${path}[]`) : z.string()
  let s = z.array(itemSchema)
  if (typeof schema.minItems === 'number') s = s.min(schema.minItems)
  if (typeof schema.maxItems === 'number') s = s.max(schema.maxItems)
  let out: z.ZodTypeAny = s
  if (schema.uniqueItems) {
    out = s.refine((arr) => new Set(arr.map((v) => JSON.stringify(v))).size === arr.length, {
      message: 'Items must be unique.',
    })
  }
  return out
}

function objectSchema(schema: JsonSchema, path: string): z.ZodTypeAny {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, propSchema] of Object.entries(properties)) {
    let propZod = convert(propSchema, `${path}.${key}`)
    if (!required.has(key)) {
      propZod = propZod.optional()
    }
    shape[key] = propZod
  }

  return z.object(shape)
}

function applyDefault(schema: JsonSchema, zodSchema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema.default !== undefined) {
    return zodSchema.default(schema.default as never)
  }
  return zodSchema
}

function convert(schema: JsonSchema, path: string): z.ZodTypeAny {
  assertSupported(schema, path)

  let base: z.ZodTypeAny
  switch (schema.type) {
    case 'string':
      base = stringSchema(schema)
      break
    case 'number':
    case 'integer':
      base = numberSchema(schema)
      break
    case 'boolean':
      base = z.boolean()
      break
    case 'array':
      base = arraySchema(schema, path)
      break
    case 'object':
      base = objectSchema(schema, path)
      break
    default:
      // No `type` given: fall back to an unconstrained string, the most
      // common case for hand-authored schemas that omit the obvious type.
      base = z.unknown()
      break
  }

  return applyDefault(schema, base)
}

/** Convert a `SchemaForm`-subset JSON Schema into a zod schema. */
export function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  return convert(schema, '$')
}
