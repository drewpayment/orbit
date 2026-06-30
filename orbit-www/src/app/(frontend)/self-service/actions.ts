'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import type { Where } from 'payload'
import type { Action, ActionRun } from '@/payload-types'
import { canRunActions, canApproveActionRun } from '@/lib/actions/authz'
import { normalizeInputSchema, type ActionInputSchema } from '@/lib/actions/input-schema'
import { executeRun, readLogs } from '@/lib/actions/run'
import { createAndDispatchRun } from '@/lib/actions/create-run'

/**
 * Self-service RUN + QUERY server actions (IDP refocus P3).
 *
 * Members browse enabled Actions ({@link listActions}), run one
 * ({@link runAction} → creates an action-run and dispatches the runner), and
 * watch the result ({@link listRuns}/{@link getRun}). Owner/admins resolve
 * approval gates ({@link approveRun}/{@link rejectRun}).
 *
 * Tenant boundary: every query is scoped to the caller's active workspaces.
 * Authoring (create/update/delete Actions) lives in the SEPARATE
 * authoring-actions.ts (Engineer C) — not here. {@link getManageableActionWorkspaces}
 * is exported here for C's New-Action workspace picker.
 *
 * Mirrors the scorecards server-action conventions: resolve the session user,
 * gate on the shared authz helpers, then run Payload writes with
 * `overrideAccess: true` (the check IS the authz).
 */

type PayloadClient = Awaited<ReturnType<typeof getPayload>>

/** Extract a relationship's id whether it arrived as a string or populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Workspace IDs the user actively belongs to — the tenant boundary. */
async function getMemberWorkspaceIds(payload: PayloadClient, userId: string): Promise<string[]> {
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: userId },
      status: { equals: 'active' },
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return memberships.docs.map((m) => (typeof m.workspace === 'string' ? m.workspace : m.workspace.id))
}

// ---------------------------------------------------------------------------
// listActions — the self-service catalog
// ---------------------------------------------------------------------------

export interface ActionSummary {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  backendType: Action['backend']['type']
  approvalPolicy: NonNullable<Action['approvalPolicy']>
  /** Workspace id this action belongs to. */
  workspace: string
  /** Normalized run-form schema (safe for the client to render). */
  inputSchema: ActionInputSchema
}

/** Map an Action doc → the client-facing summary. */
function toSummary(action: Action): ActionSummary {
  return {
    id: action.id,
    name: action.name,
    description: action.description,
    icon: action.icon,
    backendType: action.backend.type,
    approvalPolicy: action.approvalPolicy ?? 'none',
    workspace: relId(action.workspace) ?? '',
    inputSchema: normalizeInputSchema(action.inputSchema),
  }
}

/**
 * List the enabled Actions in the user's workspaces — the self-service catalog.
 */
export async function listActions(userId?: string): Promise<ActionSummary[]> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return []

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return []

  const result = await payload.find({
    collection: 'actions',
    where: {
      and: [{ workspace: { in: workspaceIds } }, { enabled: { equals: true } }],
    },
    sort: 'name',
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  return result.docs.map(toSummary)
}

/**
 * Workspaces where the user is an active owner/admin — the source list for
 * Engineer C's New-Action workspace picker (and the "can author" gate).
 */
export async function getManageableActionWorkspaces(
  userId?: string,
): Promise<{ id: string; name: string }[]> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return []

  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: uid } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  const workspaceIds = [
    ...new Set(memberships.docs.map((m) => relId(m.workspace)).filter((v): v is string => !!v)),
  ]
  if (workspaceIds.length === 0) return []

  const wsResult = await payload.find({
    collection: 'workspaces',
    where: { id: { in: workspaceIds } },
    sort: 'name',
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  return wsResult.docs.map((w) => ({ id: w.id, name: w.name }))
}

// ---------------------------------------------------------------------------
// runAction — create a run, then execute (or gate on approval)
// ---------------------------------------------------------------------------

/**
 * Run an Action: resolve the user, load + authorize the Action, validate inputs
 * against its schema, create the action-run, then either dispatch the runner
 * immediately (`approvalPolicy: 'none'`) or park the run as `awaiting-approval`.
 *
 * Returns the new run id + its status. Throws on auth/validation failure so the
 * caller surfaces the message.
 */
export async function runAction(input: {
  actionId: string
  inputs: Record<string, unknown>
}): Promise<{ runId: string; status: string }> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')

  let action: Action
  try {
    action = await payload.findByID({
      collection: 'actions',
      id: input.actionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Action not found')
  }

  const workspaceId = relId(action.workspace)
  if (action.enabled === false) throw new Error('This action is disabled.')
  if (!(await canRunActions(payload, uid, workspaceId))) {
    throw new Error('You do not have permission to run actions in this workspace.')
  }

  // Validation + approval-gating + create + execute is shared with the P4
  // automation dispatcher (createAndDispatchRun).
  return createAndDispatchRun(payload, {
    action,
    inputs: input.inputs ?? {},
    trigger: 'manual',
    triggeredBy: uid,
  })
}

// ---------------------------------------------------------------------------
// listRuns / getRun — run history
// ---------------------------------------------------------------------------

/** List action-runs in the user's workspaces, newest first (action populated). */
export async function listRuns(
  userId?: string,
  opts?: { actionId?: string },
): Promise<ActionRun[]> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return []

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return []

  const and: Where[] = [{ workspace: { in: workspaceIds } }]
  if (opts?.actionId) and.push({ action: { equals: opts.actionId } })

  const result = await payload.find({
    collection: 'action-runs',
    where: { and },
    sort: '-createdAt',
    limit: 200,
    depth: 1, // populate `action`
    overrideAccess: true,
  })

  return result.docs
}

/** Fetch one run (action populated), workspace-scoped, or null. */
export async function getRun(userId: string | undefined, runId: string): Promise<ActionRun | null> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return null

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return null

  let run: ActionRun
  try {
    run = await payload.findByID({
      collection: 'action-runs',
      id: runId,
      depth: 1,
      overrideAccess: true,
    })
  } catch {
    return null
  }
  if (!workspaceIds.includes(relId(run.workspace) ?? '')) return null
  return run
}

// ---------------------------------------------------------------------------
// approveRun / rejectRun — resolve an awaiting-approval run
// ---------------------------------------------------------------------------

/** Load a run + its policy, asserting the run is awaiting approval. */
async function loadGatedRun(
  payload: PayloadClient,
  uid: string,
  runId: string,
): Promise<{ run: ActionRun; workspaceId: string; policy: NonNullable<Action['approvalPolicy']> }> {
  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) throw new Error('No workspace access')

  let run: ActionRun
  try {
    run = await payload.findByID({
      collection: 'action-runs',
      id: runId,
      depth: 1,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Run not found')
  }

  const workspaceId = relId(run.workspace)
  if (!workspaceId || !workspaceIds.includes(workspaceId)) throw new Error('Run not found')
  if (run.status !== 'awaiting-approval') {
    throw new Error('This run is not awaiting approval.')
  }

  const action = run.action && typeof run.action === 'object' ? (run.action as Action) : null
  const policy = action?.approvalPolicy ?? 'none'
  return { run, workspaceId, policy }
}

/**
 * Approve an awaiting-approval run and continue execution. Verifies the caller
 * may approve under the action's policy via `canApproveActionRun`.
 */
export async function approveRun(runId: string): Promise<{ runId: string; status: string }> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')

  const { run, workspaceId, policy } = await loadGatedRun(payload, uid, runId)
  if (!(await canApproveActionRun(payload, uid, workspaceId, policy))) {
    throw new Error('You do not have permission to approve this run.')
  }

  const logs = readLogs(run)
  logs.push({ ts: new Date().toISOString(), level: 'info', message: 'Run approved.' })
  await payload.update({
    collection: 'action-runs',
    id: runId,
    data: { status: 'pending', logs },
    overrideAccess: true,
  })

  await executeRun(payload, runId)

  const fresh = await payload.findByID({
    collection: 'action-runs',
    id: runId,
    depth: 0,
    overrideAccess: true,
  })
  return { runId, status: fresh.status }
}

/**
 * Reject an awaiting-approval run → mark it `failed`. Same authz as approve.
 */
export async function rejectRun(runId: string): Promise<{ runId: string; status: string }> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')

  const { run, workspaceId, policy } = await loadGatedRun(payload, uid, runId)
  if (!(await canApproveActionRun(payload, uid, workspaceId, policy))) {
    throw new Error('You do not have permission to reject this run.')
  }

  const logs = readLogs(run)
  logs.push({ ts: new Date().toISOString(), level: 'warn', message: 'Run rejected.' })
  await payload.update({
    collection: 'action-runs',
    id: runId,
    data: { status: 'failed', error: 'Run rejected by an approver.', logs },
    overrideAccess: true,
  })

  return { runId, status: 'failed' }
}
