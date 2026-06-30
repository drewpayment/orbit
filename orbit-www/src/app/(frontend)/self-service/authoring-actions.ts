'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/session'
import { canManageActions } from '@/lib/actions/authz'
import { normalizeInputSchema, type ActionInputSchema } from '@/lib/actions/input-schema'
import { isBackendType } from '@/components/features/actions/action-backends'
import type { Action } from '@/payload-types'

type Payload = Awaited<ReturnType<typeof getPayload>>
type BackendType = Action['backend']['type']
type ApprovalPolicy = NonNullable<Action['approvalPolicy']>

/**
 * RBAC-gated authoring server actions for self-service Actions (IDP refocus P3).
 *
 * Defining/editing/deleting an Action is restricted to workspace owners/admins.
 * EVERY mutation here resolves the session user, determines the target
 * workspace (from the input on create; by loading the doc on update/delete),
 * and routes through {@link canManageActions} BEFORE any write — throwing on
 * denial. Writes use `overrideAccess: true` because the gate above is the single
 * source of truth (mirrors the scorecards authoring actions). Workspace is fixed
 * at create time and never mutated on update.
 */

/** Extract a relationship id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

export interface ActionFormValues {
  name: string
  description?: string | null
  icon?: string | null
  approvalPolicy: ApprovalPolicy
  backend: { type: BackendType; ref?: string | null }
  inputSchema: ActionInputSchema
  enabled: boolean
}

export interface CreateActionInput extends ActionFormValues {
  workspace: string
}

/** Update payload — `workspace` is intentionally omitted (not mutable). */
export type UpdateActionInput = ActionFormValues

/** Resolve + assert the session user; throws when unauthenticated. */
async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Throw unless the user may author Actions in `workspaceId`. */
async function assertCanManage(
  payload: Payload,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId || !(await canManageActions(payload, userId, workspaceId))) {
    throw new Error('You do not have permission to manage actions in this workspace.')
  }
}

const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['none', 'workspace-admin', 'platform-admin']

/**
 * Validate + normalise the author-supplied form values into the data Payload
 * stores. Throws on a missing name, an unknown backend type, or an invalid
 * approval policy; runs the input schema through the shared normalizer so only
 * well-formed fields are persisted.
 */
function buildActionData(values: ActionFormValues): {
  name: string
  description?: string
  icon?: string
  approvalPolicy: ApprovalPolicy
  backend: { type: BackendType; ref?: string }
  inputSchema: Action['inputSchema']
  enabled: boolean
} {
  const name = values.name?.trim()
  if (!name) throw new Error('An action name is required.')

  if (!isBackendType(values.backend?.type)) {
    throw new Error('Unknown backend type.')
  }
  if (!APPROVAL_POLICIES.includes(values.approvalPolicy)) {
    throw new Error('Unknown approval policy.')
  }

  // Re-normalise the schema server-side: never trust the client to have cleaned it.
  // Cast to the json column type — the typed schema is a structural subset of it.
  const inputSchema = normalizeInputSchema(values.inputSchema) as unknown as Action['inputSchema']
  const ref = values.backend.ref?.trim()

  return {
    name,
    description: values.description?.trim() || undefined,
    icon: values.icon?.trim() || undefined,
    approvalPolicy: values.approvalPolicy,
    backend: { type: values.backend.type, ref: ref || undefined },
    inputSchema,
    enabled: values.enabled !== false,
  }
}

export async function createAction(input: CreateActionInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  await assertCanManage(payload, uid, input.workspace)

  const data = buildActionData(input)

  const created = await payload.create({
    collection: 'actions',
    data: { ...data, workspace: input.workspace },
    overrideAccess: true,
  })

  revalidatePath('/self-service')
  return { id: created.id }
}

export async function updateAction(
  actionId: string,
  input: UpdateActionInput,
): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let action: Action
  try {
    action = await payload.findByID({
      collection: 'actions',
      id: actionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Action not found')
  }
  // Authorize against the EXISTING workspace; the field is never reassigned.
  await assertCanManage(payload, uid, relId(action.workspace))

  const data = buildActionData(input)

  const updated = await payload.update({
    collection: 'actions',
    id: actionId,
    data,
    overrideAccess: true,
  })

  revalidatePath('/self-service')
  revalidatePath(`/self-service/${actionId}/edit`)
  return { id: updated.id }
}

export async function deleteAction(actionId: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let action: Action
  try {
    action = await payload.findByID({
      collection: 'actions',
      id: actionId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Action not found')
  }
  await assertCanManage(payload, uid, relId(action.workspace))

  await payload.delete({
    collection: 'actions',
    id: actionId,
    overrideAccess: true,
  })

  revalidatePath('/self-service')
  return { id: actionId }
}
