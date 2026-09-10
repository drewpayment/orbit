// orbit-www/src/lib/scaffolder/schema.ts
import { z } from 'zod'

/**
 * v2 Scaffolder template definition schema (design §3.1, phase-1 plan §3.1).
 *
 * A "definition" is small and structured: a form (`spec.parameters`, ordered
 * JSON-Schema pages), a list of steps (`spec.steps`, typed actions with
 * `${{ }}` expressions), and an optional `spec.output`. This schema validates
 * the *shape*; cross-referential rules (step id uniqueness, expression
 * references, action existence, per-action input validation) live in
 * `validate.ts` since they need the live action registry.
 */

/**
 * One JSON-Schema-ish property in a parameter page. `.passthrough()` lets
 * authors attach the `ui:*` vocabulary (design §3.3: `ui:field`, `ui:help`,
 * `ui:visibleIf`, `ui:widget`, `ui:order`, …) without widening this schema
 * every time the form builder grows a new key.
 */
export const JsonSchemaPropertySchema = z
  .object({
    type: z.string().optional(),
  })
  .passthrough()

export const ParameterPageSchema = z.object({
  title: z.string(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), JsonSchemaPropertySchema),
})

/** `id` must be a legal `${{ steps.<id>.output.* }}` path segment. */
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]*$/

export const StepSchema = z.object({
  id: z.string().regex(STEP_ID_PATTERN, 'Step id must be lowercase kebab-case, e.g. "create-repo"'),
  name: z.string(),
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  if: z.string().optional(),
  continueOnError: z.boolean().optional(),
  /** Go duration string, e.g. "5m", "30s". Format checked here; parsed by the Go side. */
  timeout: z.string().optional(),
})

export const OutputLinkSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  entity: z.string().optional(),
})

export const OutputSchema = z.object({
  links: z.array(OutputLinkSchema).optional(),
  text: z.string().optional(),
})

export const SpecSchema = z.object({
  parameters: z.array(ParameterPageSchema),
  steps: z.array(StepSchema),
  output: OutputSchema.optional(),
})

export const MetadataSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'metadata.name must be lowercase kebab-case, e.g. "backend-service"'),
  title: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  owner: z.string(),
  targetKind: z.string().optional(),
})

export const TemplateDefinitionSchema = z.object({
  apiVersion: z.literal('orbit/v2'),
  kind: z.literal('Template'),
  metadata: MetadataSchema,
  spec: SpecSchema,
})

export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>
export type ParameterPage = z.infer<typeof ParameterPageSchema>
export type Step = z.infer<typeof StepSchema>
export type Output = z.infer<typeof OutputSchema>
