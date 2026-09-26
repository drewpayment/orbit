'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getActor, requireActor, check, memberWorkspaceIds, type Actor } from '@/lib/authz'
import {
  ensureAutomationSchedule,
  deleteAutomationSchedule,
  getScheduleNextRun,
} from '@/lib/temporal/automation-schedules'
import { AUTOMATION_EVENTS } from '@/collections/automations'
import { normalizeInputSchema } from '@/lib/actions/input-schema'
import type { Automation, ActionRun, Action } from '@/payload-types'

/**
 * Automation authoring + query server actions (IDP refocus P4).
 *
 * Listing is workspace-scoped to the caller's active memberships; authoring
 * (create/update/delete) is gated on workspace owner/admin via `@/lib/authz`'s
 * `check('manage', ...)`. Mirrors the P3 actions authoring conventions:
 * resolve the session actor, gate, then write with `overrideAccess: true` (the
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

/**
 * List automations in the user's workspaces (action populated).
 *
 * SEMANTIC CHANGE: previously took an optional `userId` that overrode the
 * session — since this is an exported `'use server'` action, callable from the
 * client with arbitrary arguments, that let a caller list ANY user's
 * workspace automations. It is now always resolved from the session actor.
 */
export async function listAutomations(): Promise<AutomationSummary[]> {
  const payload = await getPayload({ config })
  const actor = await getActor()
  if (!actor) return []

  const workspaceIds = await memberWorkspaceIds('member', actor)
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

/**
 * Workspaces where the user is owner/admin — the authoring picker source.
 *
 * SEMANTIC CHANGE: dropped the optional `userId` override for the same
 * client-injected-identity reason as {@link listAutomations}.
 */
export async function getManageableAutomationWorkspaces(): Promise<{ id: string; name: string }[]> {
  const payload = await getPayload({ config })
  const actor = await getActor()
  if (!actor) return []

  const workspaceIds = await memberWorkspaceIds('manage', actor)
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

/** One declared input on an action, projected for the authoring form. */
export interface AutomationActionInput {
  name: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  required: boolean
  options?: string[]
  help?: string
  placeholder?: string
}

/** An action option for the automation picker, with its full input contract. */
export interface AutomationActionOption {
  id: string
  name: string
  /**
   * The action's declared inputs, in schema order. The form renders one labeled
   * field per input (required ones marked) so authors fill in values directly
   * instead of guessing internal field names. Required coverage is enforced
   * server-side by {@link findUnmappedRequiredInputs}.
   */
  inputs: AutomationActionInput[]
}

/** The declared inputs of an action, derived from its normalized input schema. */
function inputsOf(inputSchema: unknown): AutomationActionInput[] {
  return normalizeInputSchema(inputSchema).fields.map((f) => ({
    name: f.name,
    label: f.label || f.name,
    type: f.type,
    required: !!f.required,
    options: f.options,
    help: f.help,
    placeholder: f.placeholder,
  }))
}

/** Enabled actions per workspace — the automation's action picker source. */
export async function getActionsByWorkspace(
  workspaceIds: string[],
): Promise<Record<string, AutomationActionOption[]>> {
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

  const byWs: Record<string, AutomationActionOption[]> = {}
  for (const a of result.docs) {
    const ws = relId(a.workspace)
    if (!ws) continue
    ;(byWs[ws] ??= []).push({ id: a.id, name: a.name, inputs: inputsOf(a.inputSchema) })
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
  actions: AutomationActionOption[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Load an automation the user may manage, shaped for the edit form, or null.
 *
 * SEMANTIC CHANGE: dropped the optional `userId` override — same
 * client-injected-identity issue as {@link listAutomations}.
 */
export async function getAutomationForEdit(automationId: string): Promise<AutomationEditData | null> {
  const payload = await getPayload({ config })
  const actor = await getActor()
  if (!actor) return null

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
  if (!workspaceId) return null
  const decision = await check('manage', { kind: 'workspace', id: workspaceId }, actor)
  if (!decision.allowed) return null

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
// Detail view (read-only observability) — workspace-scoped read
// ---------------------------------------------------------------------------

export interface AutomationRunSummary {
  id: string
  status: string
  trigger: string
  createdAt: string | null
}

/**
 * "When it runs next": a real time for cron, a descriptive label for events.
 * For schedules the time is read from Temporal (the authoritative owner of the
 * cron timing); `unavailable` flags a read-time soft failure (Temporal
 * unreachable) so the UI can degrade that line without erroring the page.
 */
export type AutomationNextRun =
  | { kind: 'event'; event: AutomationEventValue }
  | { kind: 'schedule'; cron: string; at: string | null; unavailable?: boolean }

export interface AutomationDetail {
  id: string
  workspace: string
  workspaceName: string | null
  name: string
  description: string | null
  enabled: boolean
  event: AutomationEventValue
  filter: Record<string, unknown> | null
  schedule: string | null
  actionId: string | null
  actionName: string | null
  inputMapping: Record<string, unknown> | null
  lastTriggeredAt: string | null
  canManage: boolean
  /** Most recent run this automation produced (by sourceAutomation), if any. */
  lastRun: AutomationRunSummary | null
  /** Up to 10 most recent runs, newest first. */
  recentRuns: AutomationRunSummary[]
  nextRun: AutomationNextRun
}

function toRunSummary(r: ActionRun): AutomationRunSummary {
  return {
    id: r.id,
    status: r.status,
    trigger: r.trigger ?? 'automation',
    createdAt: r.createdAt ?? null,
  }
}

/**
 * Load an automation for the read-only detail page. Workspace-scoped: any active
 * member of the automation's workspace may view it; `canManage` (owner/admin)
 * gates the Edit affordance. Returns null when not found or not a member.
 *
 * SEMANTIC CHANGE: dropped the optional `userId` override — same
 * client-injected-identity issue as {@link listAutomations}.
 */
export async function getAutomationDetail(automationId: string): Promise<AutomationDetail | null> {
  const payload = await getPayload({ config })
  const actor = await getActor()
  if (!actor) return null

  let automation: Automation
  try {
    automation = await payload.findByID({
      collection: 'automations',
      id: automationId,
      depth: 1, // populate workspace + action for their names
      overrideAccess: true,
    })
  } catch {
    return null
  }

  const workspaceId = relId(automation.workspace)
  if (!workspaceId) return null
  // Tenant boundary: the viewer must be an active member of this workspace.
  const readDecision = await check('read', { kind: 'workspace', id: workspaceId }, actor)
  if (!readDecision.allowed) return null

  const manageDecision = await check('manage', { kind: 'workspace', id: workspaceId }, actor)
  const canManage = manageDecision.allowed

  const runsResult = await payload.find({
    collection: 'action-runs',
    where: { sourceAutomation: { equals: automationId } },
    sort: '-createdAt',
    limit: 10,
    depth: 0,
    overrideAccess: true,
  })
  const recentRuns = (runsResult.docs as ActionRun[]).map(toRunSummary)

  const event = automation.trigger?.event
  const schedule = automation.trigger?.schedule ?? null
  let nextRun: AutomationNextRun
  if (event === 'schedule' && schedule) {
    // Read the authoritative next-run from Temporal. Degrade gracefully if the
    // scheduling service is unreachable at view time (read-time soft failure,
    // distinct from the write-time fail-closed authoring path).
    let at: string | null = null
    let unavailable = false
    try {
      at = await getScheduleNextRun(automationId)
    } catch {
      unavailable = true
    }
    nextRun = { kind: 'schedule', cron: schedule, at, unavailable }
  } else {
    nextRun = { kind: 'event', event }
  }

  const workspace = automation.workspace
  const action = automation.action

  return {
    id: automation.id,
    workspace: workspaceId,
    workspaceName: workspace && typeof workspace === 'object' ? workspace.name : null,
    name: automation.name,
    description: automation.description ?? null,
    enabled: automation.enabled !== false,
    event,
    filter: asRecord(automation.trigger?.filter),
    schedule,
    actionId: relId(action),
    actionName: action && typeof action === 'object' ? action.name : null,
    inputMapping: asRecord(automation.inputMapping),
    lastTriggeredAt: automation.lastTriggeredAt ?? null,
    canManage,
    lastRun: recentRuns[0] ?? null,
    recentRuns,
    nextRun,
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

async function assertCanManage(actor: Actor, workspaceId: string | null): Promise<void> {
  const decision = workspaceId
    ? await check('manage', { kind: 'workspace', id: workspaceId }, actor)
    : { allowed: false }
  if (!decision.allowed) {
    throw new Error('You do not have permission to manage automations in this workspace.')
  }
}

/**
 * Assert `actionId` is an action in `workspaceId` (no cross-tenant linking) and
 * RETURN the loaded action so callers can validate its input contract without a
 * second fetch.
 */
async function assertActionInWorkspace(
  payload: PayloadClient,
  actionId: string,
  workspaceId: string,
): Promise<Action> {
  if (!actionId) throw new Error('Select an action to run.')
  let action: Action
  try {
    action = await payload.findByID({ collection: 'actions', id: actionId, depth: 0, overrideAccess: true })
  } catch {
    throw new Error('Action not found.')
  }
  if (relId(action.workspace) !== workspaceId) {
    throw new Error('The selected action belongs to a different workspace.')
  }
  return action
}

/**
 * The required action inputs (by label) left unmapped by `inputMapping` — the
 * authoring-time guard against saving an automation that would silently fail
 * every dispatch on {@link validateInputs} ("…is required."). A required field
 * counts as mapped only when its mapping value is a non-blank literal or
 * `{{template}}`; null/absent/whitespace are unmapped.
 *
 * NOTE: this file is `'use server'`, so the export must be async (mirrors
 * {@link scheduleOpFor}) even though the computation is synchronous.
 */
export async function findUnmappedRequiredInputs(
  inputSchema: unknown,
  inputMapping: Record<string, unknown> | null | undefined,
): Promise<string[]> {
  return normalizeInputSchema(inputSchema)
    .fields.filter((f) => f.required)
    .filter((f) => {
      const v = inputMapping?.[f.name]
      return v == null || (typeof v === 'string' && v.trim() === '')
    })
    .map((f) => f.label || f.name)
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

  // Defense-in-depth (P4.2): a schedule has no triggering event, so any
  // `{{template}}` in its input mapping resolves to empty at dispatch and fails
  // non-retryably forever. Reject template values here so neither create nor
  // update can persist one — the form blocks this client-side too. Event
  // automations keep allowing templates (they have an event to interpolate).
  if (values.event === 'schedule' && inputMapping) {
    const hasTemplate = Object.values(inputMapping).some(
      (v) => typeof v === 'string' && v.includes('{{'),
    )
    if (hasTemplate) {
      throw new Error(
        'Schedule automations can’t use {{variables}} in action inputs — they resolve to nothing at run time. Use literal values.',
      )
    }
  }

  return {
    name,
    description: values.description?.trim() || undefined,
    trigger: { event: values.event, filter, schedule },
    inputMapping,
    enabled: values.enabled !== false,
  }
}

/**
 * Which Temporal Schedule operation a save implies, from the trigger event
 * before/after the change. Pure (no Temporal) so the decision table is unit-
 * testable in isolation; the `schedule` path is the only one that touches
 * Temporal, so event→event transitions are always `'none'`.
 *
 * NOTE: this file is `'use server'`, so every export must be async — hence the
 * `Promise<ScheduleOp>` return on an otherwise-synchronous decision.
 */
export type ScheduleOp = 'ensure' | 'delete' | 'none'
export async function scheduleOpFor(
  prevEvent: string | null | undefined,
  nextEvent: string,
): Promise<ScheduleOp> {
  if (nextEvent === 'schedule') return 'ensure' // other→schedule AND schedule→schedule
  if (prevEvent === 'schedule') return 'delete' // schedule→other
  return 'none'
}

const SCHEDULING_UNAVAILABLE_CREATE =
  'The scheduling service is unavailable. The automation was not created — please try again once it is reachable.'
const SCHEDULING_UNAVAILABLE_SAVE =
  'The scheduling service is unavailable. Your changes were not saved — please try again once it is reachable.'
const SCHEDULING_UNAVAILABLE_DELETE =
  'The scheduling service is unavailable. Please try again once it is reachable.'
const SCHEDULE_CRON_REQUIRED = 'A cron schedule is required for schedule-triggered automations.'

export async function createAutomation(input: CreateAutomationInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const actor = await requireActor()
  await assertCanManage(actor, input.workspace)
  const action = await assertActionInWorkspace(payload, input.actionId, input.workspace)

  const data = buildTriggerAndRest(input)

  // Every required action input must be mapped BEFORE any write — an unmapped
  // required input saves cleanly but fails `validateInputs` on every dispatch
  // (a silent automation). Runs first so nothing is created/scheduled.
  const missingInputs = await findUnmappedRequiredInputs(action.inputSchema, data.inputMapping)
  if (missingInputs.length > 0) {
    throw new Error(`Map a value for every required input on this action: ${missingInputs.join(', ')}.`)
  }

  // Validate the cron BEFORE inserting so a missing-cron mistake never creates a
  // record we then have to roll back (that rollback path is for Temporal failures).
  const isSchedule = input.event === 'schedule'
  const cron = data.trigger.schedule
  if (isSchedule && !cron) throw new Error(SCHEDULE_CRON_REQUIRED)

  const created = await payload.create({
    collection: 'automations',
    data: { ...data, workspace: input.workspace, action: input.actionId },
    overrideAccess: true,
  })

  // Fail-closed: the record only survives if its Temporal Schedule is created.
  if (isSchedule) {
    try {
      await ensureAutomationSchedule({
        id: created.id,
        workspaceId: input.workspace,
        cron: cron as string,
        enabled: data.enabled,
      })
    } catch {
      // Roll back the just-created record so we never leave a schedule
      // automation without its Schedule. A best-effort rollback failure must not
      // mask the user-facing scheduling error.
      try {
        await payload.delete({ collection: 'automations', id: created.id, overrideAccess: true })
      } catch {
        /* surface the scheduling error regardless */
      }
      throw new Error(SCHEDULING_UNAVAILABLE_CREATE)
    }
  }

  revalidatePath('/automations')
  return { id: created.id }
}

export async function updateAutomation(
  automationId: string,
  input: UpdateAutomationInput,
): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const actor = await requireActor()

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
  await assertCanManage(actor, workspaceId)
  const action = await assertActionInWorkspace(payload, input.actionId, workspaceId as string)

  const data = buildTriggerAndRest(input)

  // Same authoring-time guard as create: reject before any write/Temporal call so
  // an unmapped required input can never become a silently-failing automation.
  const missingInputs = await findUnmappedRequiredInputs(action.inputSchema, data.inputMapping)
  if (missingInputs.length > 0) {
    throw new Error(`Map a value for every required input on this action: ${missingInputs.join(', ')}.`)
  }

  const op = await scheduleOpFor(automation.trigger?.event, input.event)

  const persist = async () =>
    payload.update({
      collection: 'automations',
      id: automationId,
      data: { ...data, action: input.actionId },
      overrideAccess: true,
    })

  let updated: Automation
  if (op === 'ensure') {
    // schedule (new or unchanged): the Schedule must converge BEFORE we persist,
    // so a Temporal failure leaves the record untouched (fail-closed).
    const cron = data.trigger.schedule
    if (!cron) throw new Error(SCHEDULE_CRON_REQUIRED)
    try {
      await ensureAutomationSchedule({
        id: automationId,
        workspaceId: workspaceId as string,
        cron,
        enabled: data.enabled,
      })
    } catch {
      throw new Error(SCHEDULING_UNAVAILABLE_SAVE)
    }
    updated = await persist()
  } else if (op === 'delete') {
    // schedule→other: persist the new (non-schedule) record, then tear down the
    // now-orphaned Schedule. A delete failure throws; the dispatch path re-checks
    // `trigger.event === 'schedule'`, so a transient orphan never mis-fires.
    updated = await persist()
    try {
      await deleteAutomationSchedule(automationId)
    } catch {
      throw new Error(SCHEDULING_UNAVAILABLE_DELETE)
    }
  } else {
    // event→event: never touches Temporal.
    updated = await persist()
  }

  revalidatePath('/automations')
  revalidatePath(`/automations/${automationId}/edit`)
  return { id: updated.id }
}

export async function deleteAutomation(automationId: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const actor = await requireActor()

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
  await assertCanManage(actor, relId(automation.workspace))

  // Schedule automations: tear down the Temporal Schedule first so we never leave
  // an orphaned Schedule firing for a deleted record (fail-closed). Event
  // automations delete directly.
  if (automation.trigger?.event === 'schedule') {
    try {
      await deleteAutomationSchedule(automationId)
    } catch {
      throw new Error(SCHEDULING_UNAVAILABLE_DELETE)
    }
  }

  await payload.delete({ collection: 'automations', id: automationId, overrideAccess: true })
  revalidatePath('/automations')
  return { id: automationId }
}
