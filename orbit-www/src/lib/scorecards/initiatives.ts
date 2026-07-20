import type { CollectionSlug, Payload, Where } from 'payload'
import type {
  Initiative,
  InitiativeActionItem,
  Scorecard,
  ScorecardRule,
  ScorecardRuleResult,
  User,
} from '@/payload-types'
import type { LevelDef } from '@/components/features/scorecards/scorecard-ui'

/**
 * Initiatives sync engine (Initiatives UI + auto-generated action items,
 * docs/plans/2026-07-02-initiatives-ui.md, WP1).
 *
 * Closes the measure→improve loop (the Cortex Initiatives model): an initiative
 * targets a scorecard level by a deadline, and Orbit keeps one action item per
 * (failing entity × in-scope failing rule) in sync with the latest evaluation —
 * fixed things auto-complete, regressions reopen, waived items are sacrosanct.
 *
 * The diff/progress/scope logic is pure and unit-tested; the Payload-touching
 * wrapper (`syncInitiativeActionItems`) stays thin and mirrors `evaluate.ts`'s
 * page-loop reads + `overrideAccess` writes.
 */

// --- shared plain-data types (no Payload types leak past this module) --------

export type ItemStatus = 'open' | 'in-progress' | 'done' | 'waived'
export type InitiativeStatus = 'active' | 'completed' | 'cancelled'

/** Minimal rule shape needed to attribute a rule to a ladder rung. */
export interface RuleLite {
  id: string
  level?: string | null
}

/** A (entity, in-scope rule) pair whose latest result is failing. */
export interface FailingPair {
  entityId: string
  ruleId: string
}

/** The single latest scorecard-rule-results row for a (rule, entity) pair. */
export interface RuleResultLite {
  ruleId: string
  entityId: string
  passed: boolean
}

/** Minimal action-item shape the diff/progress functions operate on. */
export interface ActionItemLite {
  id: string
  entityId: string
  /** Null for a manually-created item with no rule — such items are never
   *  touched by sync (they are not sync-managed). */
  ruleId: string | null
  status: ItemStatus
  notes?: string | null
}

export interface InitiativeProgress {
  total: number
  open: number
  inProgress: number
  done: number
  waived: number
  /** round(100 × (done + waived) / total); 100 when total === 0. */
  pctComplete: number
}

export interface ActionItemDiff {
  toCreate: FailingPair[]
  toComplete: ActionItemLite[]
  toReopen: ActionItemLite[]
}

export interface SyncResult {
  created: number
  completed: number
  reopened: number
}

// --- view-model types (server-action contract; UI codes against these) ------

export interface InitiativeSummary {
  id: string
  name: string
  description?: string | null
  scorecardId: string
  scorecardName: string
  targetLevel?: string | null
  ownerId?: string | null
  ownerName?: string | null
  deadline?: string | null
  status: InitiativeStatus
  progress: InitiativeProgress
}

export interface InitiativeDetailItem {
  id: string
  entityId: string
  entityName: string
  entityKind?: string | null
  ruleId?: string | null
  ruleTitle?: string | null
  ruleLevel?: string | null
  status: ItemStatus
  assigneeId?: string | null
  assigneeName?: string | null
  notes?: string | null
  updatedAt: string
}

export interface InitiativeDetail {
  id: string
  name: string
  description?: string | null
  scorecardId: string
  scorecardName: string
  targetLevel?: string | null
  ownerId?: string | null
  ownerName?: string | null
  deadline?: string | null
  status: InitiativeStatus
  canManage: boolean
  progress: InitiativeProgress
  items: InitiativeDetailItem[]
}

export interface ScorecardOption {
  id: string
  name: string
  levels: { name: string; rank: number }[]
}

// --- notes appended by sync -------------------------------------------------

export const AUTO_COMPLETE_NOTE = 'auto-completed: rule now passing'
export const REOPEN_NOTE = 'reopened: rule is failing again'

// --- pure functions ---------------------------------------------------------

/** Normalise a relationship end (id string or populated doc) to its id, or null. */
function relId(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
    return String((v as { id: unknown }).id)
  }
  return null
}

/**
 * Rank of `targetLevel` within the scorecard's ladder, or `null` when the name
 * isn't on the ladder (or is absent). A null rank means "no leveled rule can be
 * placed relative to the target", so `selectInScopeRules` keeps only the
 * always-gating level-less rules in scope.
 */
export function computeTargetRank(
  levels: LevelDef[],
  targetLevel: string | null | undefined,
): number | null {
  if (!targetLevel) return null
  const match = levels.find((l) => l.name === targetLevel)
  return match ? match.rank : null
}

/**
 * The rules in scope for an initiative targeting `targetLevel`.
 *
 * Mirrors `computeEntityLevel` (evaluate.ts): level-less rules are the "base"
 * rung that gates EVERY level, so they are ALWAYS in scope regardless of the
 * target. A rule tagged with a ladder level is in scope when that level's rank
 * ≤ the target rank. A rule tagged with a level that is NOT on the ladder gates
 * no rung (computeEntityLevel simply never evaluates it against any level), so
 * it is treated as OUT of scope here. When the target rank is null (targetLevel
 * absent or off-ladder), only the level-less base rules remain in scope.
 */
export function selectInScopeRules(
  rules: RuleLite[],
  levels: LevelDef[],
  targetLevel: string | null | undefined,
): RuleLite[] {
  const targetRank = computeTargetRank(levels, targetLevel)
  const rankByName = new Map(levels.map((l) => [l.name, l.rank]))

  return rules.filter((rule) => {
    if (!rule.level) return true // base rule — gates every rung
    const rank = rankByName.get(rule.level)
    if (rank === undefined) return false // off-ladder level — gates no rung
    if (targetRank === null) return false // nothing to compare against
    return rank <= targetRank
  })
}

/**
 * The failing (entity × in-scope rule) pairs for an initiative: every latest
 * rule result that is (a) for an in-scope rule and (b) `passed === false`.
 */
export function computeFailingPairs(
  rules: RuleLite[],
  latestResults: RuleResultLite[],
  levels: LevelDef[],
  targetLevel: string | null | undefined,
): FailingPair[] {
  const inScope = new Set(selectInScopeRules(rules, levels, targetLevel).map((r) => r.id))
  const pairs: FailingPair[] = []
  for (const res of latestResults) {
    if (res.passed) continue
    if (!inScope.has(res.ruleId)) continue
    pairs.push({ entityId: res.entityId, ruleId: res.ruleId })
  }
  return pairs
}

function pairKey(entityId: string, ruleId: string): string {
  return `${entityId}::${ruleId}`
}

/**
 * Diff the current failing pairs against existing action items. Semantics
 * (docs/plans/2026-07-02-initiatives-ui.md):
 *  - failing pair with no item → create (status open).
 *  - item exists (any status), pair still failing → untouched (user state wins).
 *  - open/in-progress item whose pair now passes or left scope → auto-complete.
 *  - done item whose pair fails again → reopen.
 *  - waived item → NEVER touched, in either direction.
 * Items without a rule id are not sync-managed and are ignored entirely.
 */
export function diffActionItems(
  existing: ActionItemLite[],
  failing: FailingPair[],
): ActionItemDiff {
  const failingKeys = new Set(failing.map((p) => pairKey(p.entityId, p.ruleId)))
  const existingKeys = new Set<string>()
  const toComplete: ActionItemLite[] = []
  const toReopen: ActionItemLite[] = []

  for (const item of existing) {
    if (item.ruleId == null) continue // manual item — not sync-managed
    const key = pairKey(item.entityId, item.ruleId)
    existingKeys.add(key)
    if (item.status === 'waived') continue // sacrosanct

    if (failingKeys.has(key)) {
      if (item.status === 'done') toReopen.push(item)
      // open/in-progress + still failing → leave untouched
    } else {
      if (item.status === 'open' || item.status === 'in-progress') toComplete.push(item)
      // done + now passing → leave untouched
    }
  }

  const toCreate: FailingPair[] = []
  for (const pair of failing) {
    const key = pairKey(pair.entityId, pair.ruleId)
    if (existingKeys.has(key)) continue
    existingKeys.add(key) // dedupe repeated failing pairs defensively
    toCreate.push(pair)
  }

  return { toCreate, toComplete, toReopen }
}

/** Roll up action items into progress counts + a percent-complete. */
export function computeInitiativeProgress(
  items: Array<Pick<ActionItemLite, 'status'>>,
): InitiativeProgress {
  let open = 0
  let inProgress = 0
  let done = 0
  let waived = 0
  for (const it of items) {
    switch (it.status) {
      case 'open':
        open++
        break
      case 'in-progress':
        inProgress++
        break
      case 'done':
        done++
        break
      case 'waived':
        waived++
        break
    }
  }
  const total = items.length
  const pctComplete = total === 0 ? 100 : Math.round((100 * (done + waived)) / total)
  return { total, open, inProgress, done, waived, pctComplete }
}

/**
 * Reduce raw scorecard-rule-results rows to one latest {@link RuleResultLite}
 * per (rule, entity). The evaluation pipeline upserts a single row per
 * (scorecard, rule, entity), so there is normally exactly one row per pair; the
 * newest-`evaluatedAt`-wins dedupe is a defensive belt-and-suspenders.
 */
export function latestRuleResults(rows: ScorecardRuleResult[]): RuleResultLite[] {
  const byPair = new Map<string, { at: string; lite: RuleResultLite }>()
  for (const row of rows) {
    const ruleId = relId(row.rule)
    const entityId = relId(row.entity)
    if (!ruleId || !entityId) continue
    const at = typeof row.evaluatedAt === 'string' ? row.evaluatedAt : ''
    const key = pairKey(entityId, ruleId)
    const prev = byPair.get(key)
    if (!prev || at >= prev.at) {
      byPair.set(key, { at, lite: { ruleId, entityId, passed: !!row.passed } })
    }
  }
  return [...byPair.values()].map((v) => v.lite)
}

/** Append `line` to existing notes on a fresh line, preserving prior content. */
export function appendNote(existing: string | null | undefined, line: string): string {
  const base = (existing ?? '').trimEnd()
  return base.length > 0 ? `${base}\n${line}` : line
}

/** Map a persisted action-item row to the lite shape the diff operates on. */
export function toActionItemLite(row: InitiativeActionItem): ActionItemLite {
  return {
    id: row.id,
    entityId: relId(row.entity) ?? '',
    ruleId: relId(row.rule),
    status: (row.status ?? 'open') as ItemStatus,
    notes: row.notes ?? null,
  }
}

// --- Payload-touching wrapper -----------------------------------------------

const PAGE_SIZE = 100

/** Page-loop read of every doc matching `where` (evaluate.ts convention). */
async function loadAll<T>(
  payload: Payload,
  collection: CollectionSlug,
  where: Where,
): Promise<T[]> {
  const docs: T[] = []
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection,
      where,
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })
    docs.push(...(res.docs as T[]))
    if (!res.hasNextPage) break
  }
  return docs
}

/**
 * Reconcile one initiative's action items against the latest evaluation.
 *
 * Loads the initiative (a no-op returning zeros unless it is `active` — syncing
 * a completed/cancelled initiative must not mutate anything), its scorecard's
 * rules and latest rule results, and its existing items; applies
 * {@link diffActionItems}; and returns the counts. New items are created with
 * status `open`; auto-completions/reopens append a note on a fresh line,
 * preserving any existing notes. All writes use `overrideAccess` — the caller
 * (evaluation hook or the RBAC-gated server action) is the authorization point.
 */
export async function syncInitiativeActionItems(
  payload: Payload,
  initiativeId: string,
): Promise<SyncResult> {
  const zero: SyncResult = { created: 0, completed: 0, reopened: 0 }

  let initiative: Initiative
  try {
    initiative = (await payload.findByID({
      collection: 'initiatives',
      id: initiativeId,
      depth: 0,
      overrideAccess: true,
    })) as Initiative
  } catch {
    return zero
  }
  if (!initiative || initiative.status !== 'active') return zero

  const scorecardId = relId(initiative.scorecard)
  const workspaceId = relId(initiative.workspace)
  if (!scorecardId || !workspaceId) return zero
  const targetLevel = initiative.targetLevel ?? null

  const scorecard = (await payload.findByID({
    collection: 'scorecards',
    id: scorecardId,
    depth: 0,
    overrideAccess: true,
  })) as Scorecard
  const levels: LevelDef[] = (scorecard.levels ?? []).map((l) => ({ name: l.name, rank: l.rank }))

  const [ruleRows, resultRows, itemRows] = await Promise.all([
    loadAll<ScorecardRule>(payload, 'scorecard-rules', { scorecard: { equals: scorecardId } }),
    loadAll<ScorecardRuleResult>(payload, 'scorecard-rule-results', {
      scorecard: { equals: scorecardId },
    }),
    loadAll<InitiativeActionItem>(payload, 'initiative-action-items', {
      initiative: { equals: initiativeId },
    }),
  ])

  const ruleLites: RuleLite[] = ruleRows.map((r) => ({ id: r.id, level: r.level ?? null }))
  const latestResults = latestRuleResults(resultRows)
  const existing = itemRows.map(toActionItemLite)

  const failing = computeFailingPairs(ruleLites, latestResults, levels, targetLevel)
  const { toCreate, toComplete, toReopen } = diffActionItems(existing, failing)

  for (const pair of toCreate) {
    try {
      await payload.create({
        collection: 'initiative-action-items',
        data: {
          workspace: workspaceId,
          initiative: initiativeId,
          entity: pair.entityId,
          rule: pair.ruleId,
          status: 'open',
        },
        overrideAccess: true,
      })
    } catch (error) {
      const raced = await payload.find({
        collection: 'initiative-action-items',
        where: {
          and: [
            { initiative: { equals: initiativeId } },
            { entity: { equals: pair.entityId } },
            { rule: { equals: pair.ruleId } },
          ],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (raced.docs.length === 0) throw error
    }
  }
  for (const item of toComplete) {
    await payload.update({
      collection: 'initiative-action-items',
      id: item.id,
      data: { status: 'done', notes: appendNote(item.notes, AUTO_COMPLETE_NOTE) },
      overrideAccess: true,
    })
  }
  for (const item of toReopen) {
    await payload.update({
      collection: 'initiative-action-items',
      id: item.id,
      data: { status: 'open', notes: appendNote(item.notes, REOPEN_NOTE) },
      overrideAccess: true,
    })
  }

  return { created: toCreate.length, completed: toComplete.length, reopened: toReopen.length }
}

/** Discriminate a populated user doc from a bare id. */
export function userDisplayName(user: unknown): string | null {
  if (user && typeof user === 'object') {
    const u = user as Partial<User>
    return u.name || u.email || null
  }
  return null
}

// --- assignee validation ----------------------------------------------------

/** True when `userId` is an active member of `workspaceId`. */
export async function isActiveWorkspaceMember(
  payload: Payload,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const members = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: userId } },
        { workspace: { equals: workspaceId } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return members.docs.length > 0
}

/**
 * Guard an action-item assignee change: when `assigneeId` is a concrete user
 * id, that user MUST be an active member of the item's `workspaceId` (otherwise
 * a member could pin an arbitrary/foreign user, whose name/email would then
 * render via the detail page's populate — a mild info-disclosure). Clearing the
 * assignee (`null`/`undefined`) always passes and issues no query. Throws a
 * clear Error when the target user is not a member.
 */
export async function assertAssigneeInWorkspace(
  payload: Payload,
  assigneeId: string | null | undefined,
  workspaceId: string,
): Promise<void> {
  if (assigneeId == null || assigneeId === '') return
  if (!(await isActiveWorkspaceMember(payload, assigneeId, workspaceId))) {
    throw new Error('The assignee must be an active member of this workspace.')
  }
}
