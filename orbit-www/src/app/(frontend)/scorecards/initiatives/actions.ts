'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/session'
import type {
  CatalogEntity,
  Initiative,
  InitiativeActionItem,
  Scorecard,
  ScorecardRule,
} from '@/payload-types'
import { canManageScorecards } from '@/lib/scorecards/authz'
import {
  syncInitiativeActionItems,
  assertAssigneeInWorkspace,
  computeInitiativeProgress,
  toActionItemLite,
  userDisplayName,
  type InitiativeStatus,
  type InitiativeSummary,
  type InitiativeDetail,
  type InitiativeDetailItem,
  type ItemStatus,
  type ScorecardOption,
} from '@/lib/scorecards/initiatives'

type Payload = Awaited<ReturnType<typeof getPayload>>

/** Extract a relationship's id whether it arrived as a string or a populated doc. */
function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/**
 * Workspace IDs the user actively belongs to — the tenant boundary for every
 * query here. Mirrors `scorecards/actions.ts`'s `getMemberWorkspaceIds`.
 */
async function getMemberWorkspaceIds(payload: Payload, userId: string): Promise<string[]> {
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: { user: { equals: userId }, status: { equals: 'active' } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return memberships.docs.map((m) => (typeof m.workspace === 'string' ? m.workspace : m.workspace.id))
}

/** Resolve + assert the session user; throws when unauthenticated. */
async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Throw unless the user may manage initiatives (owner/admin) in `workspaceId`. */
async function assertCanManage(
  payload: Payload,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId || !(await canManageScorecards(payload, userId, workspaceId))) {
    throw new Error('You do not have permission to manage initiatives in this workspace.')
  }
}

function scorecardNameOf(sc: unknown): string {
  if (sc && typeof sc === 'object' && 'name' in (sc as Record<string, unknown>)) {
    return String((sc as { name: unknown }).name)
  }
  return ''
}

function revalidateInitiatives(id?: string): void {
  revalidatePath('/scorecards/initiatives')
  if (id) revalidatePath(`/scorecards/initiatives/${id}`)
}

// ---------------------------------------------------------------------------
// listInitiatives — workspace-scoped cards with progress
// ---------------------------------------------------------------------------

export async function listInitiatives(): Promise<InitiativeSummary[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return []

  const res = await payload.find({
    collection: 'initiatives',
    where: { workspace: { in: workspaceIds } },
    sort: '-createdAt',
    limit: 500,
    depth: 1, // populate scorecard (name) + owner (name)
    overrideAccess: true,
  })
  const initiatives = res.docs as Initiative[]
  if (initiatives.length === 0) return []

  // Batch every initiative's action items for progress, then group by initiative.
  const ids = initiatives.map((i) => i.id)
  const itemsRes = await payload.find({
    collection: 'initiative-action-items',
    where: { initiative: { in: ids } },
    limit: 20000,
    depth: 0,
    overrideAccess: true,
  })
  const itemsByInitiative = new Map<string, InitiativeActionItem[]>()
  for (const item of itemsRes.docs as InitiativeActionItem[]) {
    const iniId = relId(item.initiative)
    if (!iniId) continue
    const list = itemsByInitiative.get(iniId) ?? []
    list.push(item)
    itemsByInitiative.set(iniId, list)
  }

  return initiatives.map((ini) => {
    const items = itemsByInitiative.get(ini.id) ?? []
    const progress = computeInitiativeProgress(items.map(toActionItemLite))
    return {
      id: ini.id,
      name: ini.name,
      description: ini.description,
      scorecardId: relId(ini.scorecard) ?? '',
      scorecardName: scorecardNameOf(ini.scorecard),
      targetLevel: ini.targetLevel,
      ownerId: relId(ini.owner),
      ownerName: userDisplayName(ini.owner),
      deadline: ini.deadline,
      status: (ini.status ?? 'active') as InitiativeStatus,
      progress,
    }
  })
}

// ---------------------------------------------------------------------------
// getInitiativeDetail — initiative + progress + enriched items
// ---------------------------------------------------------------------------

export async function getInitiativeDetail(id: string): Promise<InitiativeDetail | null> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid || !id) return null

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return null

  let initiative: Initiative
  try {
    initiative = (await payload.findByID({
      collection: 'initiatives',
      id,
      depth: 1, // populate scorecard + owner
      overrideAccess: true,
    })) as Initiative
  } catch {
    return null
  }
  const workspaceId = relId(initiative.workspace)
  if (!initiative || !workspaceId || !workspaceIds.includes(workspaceId)) return null

  const itemsRes = await payload.find({
    collection: 'initiative-action-items',
    where: { initiative: { equals: id } },
    sort: '-updatedAt',
    limit: 20000,
    depth: 1, // populate entity (name/kind), rule (title/level), assignee (name)
    overrideAccess: true,
  })
  const itemRows = itemsRes.docs as InitiativeActionItem[]

  const items: InitiativeDetailItem[] = itemRows.map((row) => {
    const entity = row.entity as CatalogEntity | string
    const rule = row.rule as ScorecardRule | string | null | undefined
    const entityIsDoc = entity && typeof entity === 'object'
    const ruleIsDoc = rule && typeof rule === 'object'
    return {
      id: row.id,
      entityId: relId(row.entity) ?? '',
      entityName: entityIsDoc ? (entity as CatalogEntity).name : (relId(row.entity) ?? ''),
      entityKind: entityIsDoc ? (entity as CatalogEntity).kind : null,
      ruleId: relId(row.rule),
      ruleTitle: ruleIsDoc ? (rule as ScorecardRule).title : null,
      ruleLevel: ruleIsDoc ? (rule as ScorecardRule).level : null,
      status: (row.status ?? 'open') as ItemStatus,
      assigneeId: relId(row.assignee),
      assigneeName: userDisplayName(row.assignee),
      notes: row.notes ?? null,
      updatedAt: row.updatedAt,
    }
  })

  const progress = computeInitiativeProgress(itemRows.map(toActionItemLite))
  const canManage = await canManageScorecards(payload, uid, workspaceId)

  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description,
    scorecardId: relId(initiative.scorecard) ?? '',
    scorecardName: scorecardNameOf(initiative.scorecard),
    targetLevel: initiative.targetLevel,
    ownerId: relId(initiative.owner),
    ownerName: userDisplayName(initiative.owner),
    deadline: initiative.deadline,
    status: (initiative.status ?? 'active') as InitiativeStatus,
    canManage,
    progress,
    items,
  }
}

// ---------------------------------------------------------------------------
// createInitiative — lifecycle (owner/admin), then initial sync inline
// ---------------------------------------------------------------------------

export interface CreateInitiativeInput {
  name: string
  description?: string
  scorecardId: string
  targetLevel: string
  deadline?: string
}

export async function createInitiative(input: CreateInitiativeInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  if (!input.name?.trim()) throw new Error('An initiative name is required.')
  if (!input.scorecardId) throw new Error('A scorecard is required.')

  // The parent scorecard determines the workspace; the caller must manage it.
  let scorecard: Scorecard
  try {
    scorecard = (await payload.findByID({
      collection: 'scorecards',
      id: input.scorecardId,
      depth: 0,
      overrideAccess: true,
    })) as Scorecard
  } catch {
    throw new Error('Scorecard not found')
  }
  const workspaceId = relId(scorecard.workspace)
  await assertCanManage(payload, uid, workspaceId)

  const levelNames = (scorecard.levels ?? []).map((l) => l.name)
  if (!input.targetLevel || !levelNames.includes(input.targetLevel)) {
    throw new Error('The target level must be one of the scorecard levels.')
  }

  const created = await payload.create({
    collection: 'initiatives',
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      workspace: workspaceId as string,
      scorecard: input.scorecardId,
      targetLevel: input.targetLevel,
      owner: uid,
      deadline: input.deadline || undefined,
      status: 'active',
    },
    overrideAccess: true,
  })

  // Populate action items immediately so the detail page lands populated.
  await syncInitiativeActionItems(payload, created.id)

  revalidateInitiatives(created.id)
  return { id: created.id }
}

// ---------------------------------------------------------------------------
// updateInitiativeStatus — lifecycle (owner/admin)
// ---------------------------------------------------------------------------

export async function updateInitiativeStatus(
  id: string,
  status: InitiativeStatus,
): Promise<void> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let initiative: Initiative
  try {
    initiative = (await payload.findByID({
      collection: 'initiatives',
      id,
      depth: 0,
      overrideAccess: true,
    })) as Initiative
  } catch {
    throw new Error('Initiative not found')
  }
  await assertCanManage(payload, uid, relId(initiative.workspace))

  if (!['active', 'completed', 'cancelled'].includes(status)) {
    throw new Error('Invalid initiative status.')
  }

  await payload.update({
    collection: 'initiatives',
    id,
    data: { status },
    overrideAccess: true,
  })

  revalidateInitiatives(id)
}

// ---------------------------------------------------------------------------
// syncInitiative — lifecycle (owner/admin), on-demand reconcile
// ---------------------------------------------------------------------------

export async function syncInitiative(
  id: string,
): Promise<{ created: number; completed: number; reopened: number }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let initiative: Initiative
  try {
    initiative = (await payload.findByID({
      collection: 'initiatives',
      id,
      depth: 0,
      overrideAccess: true,
    })) as Initiative
  } catch {
    throw new Error('Initiative not found')
  }
  await assertCanManage(payload, uid, relId(initiative.workspace))

  const result = await syncInitiativeActionItems(payload, id)
  revalidateInitiatives(id)
  return result
}

// ---------------------------------------------------------------------------
// updateActionItem — any workspace member may work their items
// ---------------------------------------------------------------------------

export interface UpdateActionItemPatch {
  status?: ItemStatus
  assigneeId?: string | null
  notes?: string
}

export async function updateActionItem(id: string, patch: UpdateActionItemPatch): Promise<void> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let item: InitiativeActionItem
  try {
    item = (await payload.findByID({
      collection: 'initiative-action-items',
      id,
      depth: 0,
      overrideAccess: true,
    })) as InitiativeActionItem
  } catch {
    throw new Error('Action item not found')
  }

  // Any active member of the item's workspace may update it (assignees work
  // their items) — no owner/admin gate here, unlike lifecycle actions.
  const workspaceId = relId(item.workspace)
  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (!workspaceId || !workspaceIds.includes(workspaceId)) {
    throw new Error('You do not have access to this action item.')
  }

  // A concrete assignee must be an active member of the item's workspace —
  // block pinning an arbitrary/foreign user (their name/email would leak via
  // the detail page's depth-1 populate). Clearing the assignee always passes.
  if (patch.assigneeId !== undefined) {
    await assertAssigneeInWorkspace(payload, patch.assigneeId, workspaceId)
  }

  const data: Record<string, unknown> = {}
  if (patch.status !== undefined) {
    if (!['open', 'in-progress', 'done', 'waived'].includes(patch.status)) {
      throw new Error('Invalid action item status.')
    }
    data.status = patch.status
  }
  if (patch.assigneeId !== undefined) data.assignee = patch.assigneeId || null
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() ? patch.notes : null

  await payload.update({
    collection: 'initiative-action-items',
    id,
    data,
    overrideAccess: true,
  })

  revalidateInitiatives(relId(item.initiative) ?? undefined)
}

// ---------------------------------------------------------------------------
// listScorecardOptions — create-form source (enabled scorecards with ≥1 level)
// ---------------------------------------------------------------------------

export async function listScorecardOptions(): Promise<ScorecardOption[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return []

  const res = await payload.find({
    collection: 'scorecards',
    where: { and: [{ workspace: { in: workspaceIds } }, { enabled: { equals: true } }] },
    sort: 'name',
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  return (res.docs as Scorecard[])
    .map((sc) => ({
      id: sc.id,
      name: sc.name,
      levels: (sc.levels ?? [])
        .map((l) => ({ name: l.name, rank: l.rank }))
        .sort((a, b) => a.rank - b.rank),
    }))
    .filter((opt) => opt.levels.length > 0)
}
