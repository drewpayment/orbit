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
    // Loop guard (P4): an automation-run that creates an entity must NOT re-emit
    // an entity-changed event, or an entity-changed automation could recurse.
    context: { skipAutomationEmit: true },
  })

  log('info', `Created catalog entity ${created.id}.`)

  return { outputs: { entityId: created.id, slug: created.slug ?? slugify(name) }, entityId: created.id }
}

/**
 * `notify-owner` — record a notification about a catalog entity (IDP refocus P4).
 *
 * The default remediation handler for drift automations: when a scorecard rule
 * flips to failing, an automation runs this with the drifted entity + a reason,
 * and the resulting action-run is the durable, visible remediation task. If an
 * `entity` (catalog-entities id) is supplied, the owning team is resolved and
 * recorded so the notification has an addressee. No external delivery in v1 —
 * the run record IS the notification surface (a channel sink is a follow-up).
 *
 * Inputs: `{ entity?: string, message?: string }`.
 */
const notifyOwner: BuiltinHandler = async ({ payload, workspaceId, inputs, log }) => {
  const message = stringInput(inputs, 'message') ?? 'Attention required.'
  const entityId = stringInput(inputs, 'entity')

  let owner: string | null = null
  let entityName: string | null = null
  if (entityId) {
    try {
      const entity = await payload.findByID({
        collection: 'catalog-entities',
        id: entityId,
        depth: 1,
        overrideAccess: true,
      })
      // Stay inside the run's tenant boundary.
      const entityWs =
        typeof entity.workspace === 'string' ? entity.workspace : entity.workspace?.id
      if (entityWs && String(entityWs) !== workspaceId) {
        throw new Error('Entity is outside this run’s workspace.')
      }
      entityName = entity.name ?? null
      const ownerRef = entity.owner
      if (ownerRef && typeof ownerRef === 'object') owner = ownerRef.name ?? ownerRef.id ?? null
      else if (typeof ownerRef === 'string') owner = ownerRef
    } catch (err) {
      log('warn', `Could not resolve entity ${entityId}: ${(err as Error).message}`)
    }
  }

  log(
    'info',
    `Notification${entityName ? ` for "${entityName}"` : ''}${owner ? ` (owner: ${owner})` : ''}: ${message}`,
  )

  return {
    outputs: { notified: true, entity: entityId ?? null, owner, message },
    ...(entityId ? { entityId } : {}),
  }
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
  'notify-owner': notifyOwner,
  echo,
  noop: echo,
}
