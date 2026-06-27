'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/session'
import { canManageAutomations } from '@/lib/automations/authz'
import { AUTOMATION_EVENTS } from '@/collections/automations'
import type { Automation } from '@/payload-types'

/**
 * Automation authoring + query server actions (IDP refocus P4).
 *
 * Listing is workspace-scoped to the caller's active memberships; authoring
 * (create/update/delete) is gated on workspace owner/admin via
 * {@link canManageAutomations}. Mirrors the P3 actions authoring conventions:
 * resolve the session user, gate, then write with `overrideAccess: true` (the
 * gate IS the authz). Workspace is fixed at create and never reassigned.
 */

type PayloadClient = Awaited<ReturnType<typeof getPayload>>
type AutomationEventValue = Automation['trigger']['event']

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Workspace ids the user actively belongs to — the read tenant boundary. */
async function getMemberWorkspaceIds(payload: PayloadClient, userId: string): Promise<string[]> {
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: { user: { equals: userId }, status: { equals: 'active' } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return memberships.docs.map((m) => (typeof m.workspace === 'string' ? m.workspace : m.workspace.id))
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface AutomationSummary {
  id: string
  name: string
  description?: string | null
  workspace: string
  event: AutomationEventValue
  actionId: string | null
  actionName: string | null
  enabled: boolean
  lastTriggeredAt?: string | null
}

function toSummary(a: Automation): AutomationSummary {
  const action = a.action
  const actionName = action && typeof action === 'object' ? action.name : null
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    workspace: relId(a.workspace) ?? '',
    event: a.trigger?.event,
    actionId: relId(action),
    actionName,
    enabled: a.enabled !== false,
    lastTriggeredAt: a.lastTriggeredAt,
  }
}

/** List automations in the user's workspaces (action populated). */
export async function listAutomations(userId?: string): Promise<AutomationSummary[]> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return []

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return []

  const result = await payload.find({
    collection: 'automations',
    where: { workspace: { in: workspaceIds } },
    sort: 'name',
    limit: 500,
    depth: 1, // populate `action` for its name
    overrideAccess: true,
  })

  return result.docs.map(toSummary)
}

/** Workspaces where the user is owner/admin — the authoring picker source. */
export async function getManageableAutomationWorkspaces(
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

/** Enabled actions per workspace — the automation's action picker source. */
export async function getActionsByWorkspace(
  workspaceIds: string[],
): Promise<Record<string, { id: string; name: string }[]>> {
  const payload = await getPayload({ config })
  if (workspaceIds.length === 0) return {}

  const result = await payload.find({
    collection: 'actions',
    where: { and: [{ workspace: { in: workspaceIds } }, { enabled: { equals: true } }] },
    sort: 'name',
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })

  const byWs: Record<string, { id: string; name: string }[]> = {}
  for (const a of result.docs) {
    const ws = relId(a.workspace)
    if (!ws) continue
    ;(byWs[ws] ??= []).push({ id: a.id, name: a.name })
  }
  return byWs
}

export interface AutomationEditData {
  id: string
  workspace: string
  name: string
  description: string | null
  event: AutomationEventValue
  filter: Record<string, unknown> | null
  schedule: string | null
  actionId: string | null
  inputMapping: Record<string, unknown> | null
  enabled: boolean
  /** Enabled actions in this automation's workspace, for the picker. */
  actions: { id: string; name: string }[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Load an automation the user may manage, shaped for the edit form, or null. */
export async function getAutomationForEdit(
  userId: string | undefined,
  automationId: string,
): Promise<AutomationEditData | null> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
  if (!uid) return null

  let automation: Automation
  try {
    automation = await payload.findByID({
      collection: 'automations',
      id: automationId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return null
  }
  const workspaceId = relId(automation.workspace)
  if (!workspaceId || !(await canManageAutomations(payload, uid, workspaceId))) return null

  const byWs = await getActionsByWorkspace([workspaceId])

  return {
    id: automation.id,
    workspace: workspaceId,
    name: automation.name,
    description: automation.description ?? null,
    event: automation.trigger?.event,
    filter: asRecord(automation.trigger?.filter),
    schedule: automation.trigger?.schedule ?? null,
    actionId: relId(automation.action),
    inputMapping: asRecord(automation.inputMapping),
    enabled: automation.enabled !== false,
    actions: byWs[workspaceId] ?? [],
  }
}

// ---------------------------------------------------------------------------
// Authoring (create / update / delete) — gated on owner/admin
// ---------------------------------------------------------------------------

export interface AutomationFormValues {
  name: string
  description?: string | null
  event: AutomationEventValue
  filter?: Record<string, unknown> | null
  schedule?: string | null
  actionId: string
  inputMapping?: Record<string, unknown> | null
  enabled: boolean
}

export interface CreateAutomationInput extends AutomationFormValues {
  workspace: string
}
export type UpdateAutomationInput = AutomationFormValues

async function assertCanManage(
  payload: PayloadClient,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId || !(await canManageAutomations(payload, userId, workspaceId))) {
    throw new Error('You do not have permission to manage automations in this workspace.')
  }
}

/** Assert `actionId` is an action in `workspaceId` (no cross-tenant linking). */
async function assertActionInWorkspace(
  payload: PayloadClient,
  actionId: string,
  workspaceId: string,
): Promise<void> {
  if (!actionId) throw new Error('Select an action to run.')
  let action
  try {
    action = await payload.findByID({ collection: 'actions', id: actionId, depth: 0, overrideAccess: true })
  } catch {
    throw new Error('Action not found.')
  }
  if (relId(action.workspace) !== workspaceId) {
    throw new Error('The selected action belongs to a different workspace.')
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/** Validate + normalise author-supplied values into stored data. */
function buildTriggerAndRest(values: AutomationFormValues) {
  const name = values.name?.trim()
  if (!name) throw new Error('An automation name is required.')
  if (!(AUTOMATION_EVENTS as readonly string[]).includes(values.event)) {
    throw new Error('Unknown trigger event.')
  }

  const filter = isRecord(values.filter) && Object.keys(values.filter).length > 0 ? values.filter : undefined
  const inputMapping =
    isRecord(values.inputMapping) && Object.keys(values.inputMapping).length > 0
      ? values.inputMapping
      : undefined
  const schedule = values.event === 'schedule' ? values.schedule?.trim() || undefined : undefined

  return {
    name,
    description: values.description?.trim() || undefined,
    trigger: { event: values.event, filter, schedule },
    inputMapping,
    enabled: values.enabled !== false,
  }
}

export async function createAutomation(input: CreateAutomationInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  await assertCanManage(payload, uid, input.workspace)
  await assertActionInWorkspace(payload, input.actionId, input.workspace)

  const data = buildTriggerAndRest(input)
  const created = await payload.create({
    collection: 'automations',
    data: { ...data, workspace: input.workspace, action: input.actionId },
    overrideAccess: true,
  })

  revalidatePath('/automations')
  return { id: created.id }
}

export async function updateAutomation(
  automationId: string,
  input: UpdateAutomationInput,
): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let automation: Automation
  try {
    automation = await payload.findByID({
      collection: 'automations',
      id: automationId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Automation not found')
  }
  const workspaceId = relId(automation.workspace)
  await assertCanManage(payload, uid, workspaceId)
  await assertActionInWorkspace(payload, input.actionId, workspaceId as string)

  const data = buildTriggerAndRest(input)
  const updated = await payload.update({
    collection: 'automations',
    id: automationId,
    data: { ...data, action: input.actionId },
    overrideAccess: true,
  })

  revalidatePath('/automations')
  revalidatePath(`/automations/${automationId}/edit`)
  return { id: updated.id }
}

export async function deleteAutomation(automationId: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let automation: Automation
  try {
    automation = await payload.findByID({
      collection: 'automations',
      id: automationId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Automation not found')
  }
  await assertCanManage(payload, uid, relId(automation.workspace))

  await payload.delete({ collection: 'automations', id: automationId, overrideAccess: true })
  revalidatePath('/automations')
  return { id: automationId }
}
