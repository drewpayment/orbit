import type { Payload } from 'payload'
import { slugify } from '@/lib/catalog/projection'

/**
 * Builtin Action handlers (IDP refocus P3).
 *
 * A `builtin` Action runs entirely in the TS layer — no Temporal, no external
 * call. `Action.backend.ref` names which handler in {@link BUILTIN_HANDLERS}
 * runs. Each handler is a pure-ish unit: given the run's workspace + validated
 * inputs and a Payload client, it performs its effect and returns `outputs`
 * (and optionally an `entityId` to record on the run). Handlers THROW on
 * failure; the runner translates a throw into a failed run with the message.
 *
 * All Payload writes here use `overrideAccess: true` — the runner already
 * authorized the caller via `canRunActions` before dispatch.
 */

/** What a builtin handler receives. */
export interface BuiltinHandlerContext {
  payload: Payload
  /** The run's workspace id (tenant boundary for any rows the handler writes). */
  workspaceId: string
  /** Inputs already validated + coerced against the Action inputSchema. */
  inputs: Record<string, unknown>
  /** Append a structured log line to the run (ISO-timestamped by the runner). */
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}

/** What a builtin handler returns. */
export interface BuiltinHandlerResult {
  outputs: Record<string, unknown>
  /** A catalog-entities id this run produced/targeted, recorded on the run. */
  entityId?: string
}

export type BuiltinHandler = (ctx: BuiltinHandlerContext) => Promise<BuiltinHandlerResult>

/** Read a string input, trimmed; undefined when absent/blank. */
function stringInput(inputs: Record<string, unknown>, key: string): string | undefined {
  const v = inputs[key]
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

/**
 * `register-service` — register a new service in the catalog.
 *
 * Creates a `catalog-entities` row of kind `service` in the run's workspace
 * from `{ name, description? }`, with provenance `source.type: 'manual'`. This
 * is the self-service "Register a service" path that complements the projected
 * (apps/api/kafka) entities. Returns the created entity id as both the run's
 * `entity` and an `entityId` output.
 */
const registerService: BuiltinHandler = async ({ payload, workspaceId, inputs, log }) => {
  const name = stringInput(inputs, 'name')
  if (!name) throw new Error('register-service requires a "name" input.')
  const description = stringInput(inputs, 'description')

  log('info', `Registering service "${name}" in the catalog.`)

  const created = await payload.create({
    collection: 'catalog-entities',
    data: {
      name,
      slug: slugify(name),
      kind: 'service',
      workspace: workspaceId,
      description: description ?? null,
      source: { type: 'manual' },
    },
    overrideAccess: true,
  })

  log('info', `Created catalog entity ${created.id}.`)

  return { outputs: { entityId: created.id, slug: created.slug ?? slugify(name) }, entityId: created.id }
}

/**
 * `echo` (alias `noop`) — return the inputs as outputs without side effects.
 * Handy for testing the run pipeline and approval gating end-to-end.
 */
const echo: BuiltinHandler = async ({ inputs, log }) => {
  log('info', 'echo handler: returning inputs as outputs.')
  return { outputs: { ...inputs } }
}

/** Registry of builtin handlers, keyed by `Action.backend.ref`. */
export const BUILTIN_HANDLERS: Record<string, BuiltinHandler> = {
  'register-service': registerService,
  echo,
  noop: echo,
}
