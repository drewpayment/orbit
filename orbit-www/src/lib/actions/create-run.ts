import 'server-only'
import type { Payload } from 'payload'
import type { Action } from '@/payload-types'
import { normalizeInputSchema, validateInputs } from './input-schema'
import { executeRun, type RunLogEntry } from './run'

/**
 * Shared action-run creation + dispatch (IDP refocus P3/P4).
 *
 * The core of "run an Action" lifted out of the manual `runAction` server action
 * so the P4 automation dispatcher reuses the SAME validation + approval-gating +
 * execute path. Given an already-loaded (and already-authorized) Action, this:
 *   1. validates `inputs` against the Action's inputSchema (throws on invalid),
 *   2. creates the action-run (`awaiting-approval` if the Action requires
 *      approval, else `pending`),
 *   3. executes immediately when no approval is needed (reusing {@link executeRun}),
 *   4. returns the run id + post-execution status.
 *
 * Authorization is the CALLER's responsibility — `runAction` enforces
 * `canRunActions`; the automation dispatcher's authority IS the owner/admin who
 * authored the enabled automation. All writes use `overrideAccess: true`.
 */

/** Resolve a relationship field to its id. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

export interface CreateAndDispatchRunInput {
  /** The Action to run, already loaded (depth 0 is fine). */
  action: Action
  /** Raw inputs; validated against the Action's inputSchema here. */
  inputs: Record<string, unknown>
  /** What initiated this run. */
  trigger: 'manual' | 'automation'
  /** The user who initiated it (null for automation/system runs). */
  triggeredBy?: string | null
  /** A catalog-entities id this run targets (e.g. the entity that drifted). */
  entityId?: string | null
  /** Extra context for the run's first log line (e.g. the automation name). */
  origin?: string
}

/**
 * Create an action-run for `action` and dispatch it (or park it for approval).
 * Throws on input-validation failure so the caller can surface the message.
 */
export async function createAndDispatchRun(
  payload: Payload,
  input: CreateAndDispatchRunInput,
): Promise<{ runId: string; status: string }> {
  const { action } = input
  const workspaceId = relId(action.workspace)
  if (!workspaceId) throw new Error('Action has no workspace.')

  const schema = normalizeInputSchema(action.inputSchema)
  const validation = validateInputs(schema, input.inputs ?? {})
  if (!validation.ok) throw new Error(validation.error)

  // `entity` is a relationship → catalog-entities; a non-ObjectId value would
  // make the create throw and drop the whole run. The in-process hook path
  // always passes a real id, but guard defensively: link only a well-formed id,
  // otherwise still create the run (the run record is the remediation task).
  const entityId =
    input.entityId && /^[a-f0-9]{24}$/i.test(input.entityId) ? input.entityId : undefined

  const policy = action.approvalPolicy ?? 'none'
  const needsApproval = policy !== 'none'

  const createdMsg =
    input.trigger === 'automation'
      ? `Run created by automation${input.origin ? ` "${input.origin}"` : ''}${
          needsApproval ? `; awaiting ${policy} approval.` : '.'
        }`
      : needsApproval
        ? `Run created; awaiting ${policy} approval.`
        : 'Run created.'
  const initialLog: RunLogEntry = {
    ts: new Date().toISOString(),
    level: 'info',
    message: createdMsg,
  }

  const run = await payload.create({
    collection: 'action-runs',
    data: {
      action: action.id,
      workspace: workspaceId,
      inputs: validation.values,
      status: needsApproval ? 'awaiting-approval' : 'pending',
      logs: [initialLog],
      triggeredBy: input.triggeredBy ?? null,
      trigger: input.trigger,
      ...(entityId ? { entity: entityId } : {}),
    },
    overrideAccess: true,
  })

  if (!needsApproval) {
    await executeRun(payload, run.id)
  }

  const fresh = await payload.findByID({
    collection: 'action-runs',
    id: run.id,
    depth: 0,
    overrideAccess: true,
  })
  return { runId: run.id, status: fresh.status }
}
