import 'server-only'
import type { Payload } from 'payload'
import type { Action, ActionRun } from '@/payload-types'
import { BUILTIN_HANDLERS, type BuiltinHandlerContext } from './builtins'
import { startScaffolderRun } from '@/lib/clients/template-client'
import type { JsonObject } from '@bufbuild/protobuf'

/**
 * Action execution runner (IDP refocus P3).
 *
 * {@link executeRun} is the single entry point that advances an action-run from
 * `running` to `succeeded`/`failed`, dispatching on `Action.backend.type`:
 *   - `builtin`  → run a handler from the builtins registry (in-process).
 *   - `webhook`  → POST `{ inputs }` to the backend URL.
 *   - `temporal-*` / `kafka-provision` / `agent` → DEFERRED in v1: not executed
 *     here; left in a non-succeeded state for the future Go ActionDispatch
 *     workflow (which writes back via /api/internal/action-runs/[id]/status).
 *
 * Logs are append-only `{ ts, level, message }` rows. All writes use
 * `overrideAccess: true` — the caller (runAction / approveRun) already enforced
 * `canRunActions` / `canApproveActionRun`. Handler errors are caught and turned
 * into a `failed` run; this function never throws out to the server action.
 */

/** One append-only run log row. */
export interface RunLogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  message: string
}

/** Resolve a relationship field to its id (handles populated or raw). */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Read a run's existing logs as a clean array (tolerant of the JSON column). */
export function readLogs(run: Pick<ActionRun, 'logs'>): RunLogEntry[] {
  const raw = run.logs
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is RunLogEntry => !!e && typeof e === 'object' && 'message' in e)
}

/** Inputs as a plain record (the column may be array/scalar in odd cases). */
function readInputs(run: ActionRun): Record<string, unknown> {
  const raw = run.inputs
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

/** Backend types deferred to the (not-yet-wired) Temporal ActionDispatch workflow. */
const DEFERRED_BACKENDS = new Set([
  'temporal-template',
  'temporal-pattern',
  'temporal-launch',
  'kafka-provision',
  'agent',
])

/** Persist the run with a fresh logs array + the given patch. */
async function writeRun(
  payload: Payload,
  runId: string,
  logs: RunLogEntry[],
  patch: Partial<Pick<ActionRun, 'status' | 'outputs' | 'error' | 'entity' | 'workflowId'>>,
): Promise<void> {
  await payload.update({
    collection: 'action-runs',
    id: runId,
    data: { ...patch, logs },
    overrideAccess: true,
  })
}

/** Truncate a webhook response body so a huge payload never bloats the run. */
function truncate(body: string, max = 2000): string {
  return body.length > max ? `${body.slice(0, max)}… (truncated)` : body
}

/**
 * Execute a single action-run. Loads the run + its Action, flips to `running`,
 * dispatches by backend type, and records the terminal status/outputs/logs.
 * Idempotency is the caller's responsibility (it should only call this for a
 * run that is pending/awaiting-approval).
 */
export async function executeRun(payload: Payload, runId: string): Promise<void> {
  let run: ActionRun
  try {
    run = await payload.findByID({
      collection: 'action-runs',
      id: runId,
      depth: 1, // populate `action`
      overrideAccess: true,
    })
  } catch {
    return // run vanished; nothing to do
  }

  const logs = readLogs(run)
  const append = (level: RunLogEntry['level'], message: string) => {
    logs.push({ ts: new Date().toISOString(), level, message })
  }

  // Resolve the Action (populated at depth 1, but tolerate an id).
  let action: Action | null =
    run.action && typeof run.action === 'object' ? (run.action as Action) : null
  if (!action) {
    const actionId = relId(run.action)
    if (actionId) {
      try {
        action = await payload.findByID({
          collection: 'actions',
          id: actionId,
          overrideAccess: true,
        })
      } catch {
        action = null
      }
    }
  }
  if (!action) {
    append('error', 'Action not found for this run.')
    await writeRun(payload, runId, logs, { status: 'failed', error: 'Action not found.' })
    return
  }

  const backendType = action.backend?.type
  const backendRef = action.backend?.ref ?? undefined
  const workspaceId = relId(run.workspace)
  const inputs = readInputs(run)

  // Deferred backends: do NOT execute. Leave non-succeeded for the worker.
  if (backendType && DEFERRED_BACKENDS.has(backendType)) {
    append(
      'info',
      'Temporal-backed dispatch is not yet wired (deferred to the ActionDispatch workflow).',
    )
    await writeRun(payload, runId, logs, { status: 'pending' })
    return
  }

  if (!workspaceId) {
    append('error', 'Run has no workspace; cannot execute.')
    await writeRun(payload, runId, logs, { status: 'failed', error: 'Run has no workspace.' })
    return
  }

  append('info', `Starting ${backendType ?? 'unknown'} action "${action.name}".`)
  await writeRun(payload, runId, logs, { status: 'running' })

  try {
    if (backendType === 'builtin') {
      const handler = backendRef ? BUILTIN_HANDLERS[backendRef] : undefined
      if (!handler) {
        throw new Error(`Unknown builtin handler "${backendRef ?? ''}".`)
      }
      const ctx: BuiltinHandlerContext = { payload, workspaceId, inputs, log: append }
      const result = await handler(ctx)
      append('info', 'Action succeeded.')
      await writeRun(payload, runId, logs, {
        status: 'succeeded',
        outputs: result.outputs,
        ...(result.entityId ? { entity: result.entityId } : {}),
      })
      return
    }

    if (backendType === 'webhook') {
      if (!backendRef || !/^https?:\/\//i.test(backendRef)) {
        throw new Error('webhook backend requires an http(s) URL in backend.ref.')
      }
      append('info', `POSTing inputs to ${backendRef}.`)
      let status: number
      let bodyText: string
      try {
        const res = await fetch(backendRef, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs }),
        })
        status = res.status
        bodyText = truncate(await res.text())
      } catch (netErr) {
        throw new Error(`webhook request failed: ${(netErr as Error).message}`)
      }
      const outputs = { status, body: bodyText }
      if (status >= 200 && status < 300) {
        append('info', `Webhook responded ${status}.`)
        await writeRun(payload, runId, logs, { status: 'succeeded', outputs })
      } else {
        append('error', `Webhook responded ${status}.`)
        await writeRun(payload, runId, logs, {
          status: 'failed',
          outputs,
          error: `Webhook returned HTTP ${status}.`,
        })
      }
      return
    }

    if (backendType === 'scaffolder') {
      if (!backendRef) {
        throw new Error('scaffolder backend requires backend.ref (a template-definitions doc id).')
      }

      // BLOCKER 1: a scaffolder-backed run must have come through
      // startDryRun/startRun (self-service/templates/authoring-actions.ts) —
      // those are the only callers that record `templateVersion` on the run
      // and enforce the RBAC/publish gates BEFORE creating it. A run that
      // reached here via the generic Actions catalog (runAction is now
      // rejected at the source for this backend type, but defend in depth
      // here too) has no templateVersion — refuse it.
      const runTemplateVersionId = relId(run.templateVersion)
      if (!runTemplateVersionId) {
        throw new Error(
          'This run has no templateVersion recorded — scaffolder runs must be created via ' +
            'startDryRun/startRun, not dispatched directly.',
        )
      }

      const definition = await payload.findByID({
        collection: 'template-definitions',
        id: backendRef,
        depth: 0,
        overrideAccess: true,
      })

      // BLOCKER 1: a REAL (non-dry) run may only dispatch a published
      // definition — an unpublished draft has not passed the publish gate
      // (validated + successful dry run of the reviewed version).
      if (!run.dryRun && definition.status !== 'published') {
        throw new Error(
          `Template definition "${definition.name}" is not published (status: ${definition.status}) — ` +
            'only dry runs may execute an unpublished draft.',
        )
      }

      // BLOCKER 2: tenant isolation. The definition, the run, and the
      // backing Action must all agree on the workspace — refuse a
      // cross-tenant dispatch rather than silently running one tenant's
      // template against another's workspace id.
      const definitionWorkspaceId = relId(definition.workspace)
      const actionWorkspaceId = relId(action.workspace)
      if (definitionWorkspaceId !== workspaceId || definitionWorkspaceId !== actionWorkspaceId) {
        throw new Error(
          `Workspace mismatch: run.workspace=${workspaceId}, action.workspace=${actionWorkspaceId}, ` +
            `template-definitions.workspace=${definitionWorkspaceId} — refusing a cross-tenant dispatch.`,
        )
      }

      // MAJOR 4: dispatch the version the run was actually created/reviewed
      // against, NOT the definition's current version — currentVersion may
      // have moved on since an approval-gated run was queued.
      const definitionVersionId = runTemplateVersionId
      const userId = relId(run.triggeredBy) ?? ''
      append(
        'info',
        `Dispatching ${run.dryRun ? 'dry run' : 'run'} of "${definition.name}" v${definitionVersionId} via ScaffolderWorkflow.`,
      )
      const result = await startScaffolderRun({
        runId,
        definitionVersionId,
        workspaceId,
        userId,
        // The `inputs` JSON column is already plain JSON-compatible data —
        // it's a structural JsonObject even though Payload types it loosely.
        parameters: inputs as unknown as JsonObject,
        dryRun: run.dryRun ?? false,
      })
      append('info', `Started ScaffolderWorkflow ${result.workflowId}.`)
      // The Go worker owns terminal status from here (writes back via
      // /api/internal/action-runs/[id]/status) — leave status "running".
      await writeRun(payload, runId, logs, { workflowId: result.workflowId })
      return
    }

    // Unknown / unsupported backend type.
    throw new Error(`Unsupported backend type "${backendType ?? ''}".`)
  } catch (err) {
    const message = (err as Error).message || 'Action failed.'
    append('error', message)
    await writeRun(payload, runId, logs, { status: 'failed', error: message })
  }
}
