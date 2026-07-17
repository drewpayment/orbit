'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import type { Scorecard, ScorecardRule, ScorecardRuleResult, CatalogEntity } from '@/payload-types'
import { clearScorecardProjections, runScorecardEvaluation } from '@/lib/scorecards/evaluate'
import { canManageScorecards } from '@/lib/scorecards/authz'
import { validateExpression } from '@/components/features/scorecards/rule-builder'
import {
  buildLevelDistribution,
  computeEntityLevel,
  type LevelBucket,
  type LevelDef,
} from '@/components/features/scorecards/scorecard-ui'

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
 * Resolve the workspace IDs the given user actively belongs to — the tenant
 * boundary for every scorecard query below. Mirrors the catalog actions'
 * `getMemberWorkspaceIds`.
 */
async function getMemberWorkspaceIds(payload: Payload, userId: string): Promise<string[]> {
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

  return memberships.docs.map((m) =>
    typeof m.workspace === 'string' ? m.workspace : m.workspace.id,
  )
}

/** Normalise a scorecard's ladder into clean {@link LevelDef}s, lowest rank first. */
function scorecardLevels(scorecard: Scorecard): LevelDef[] {
  return (scorecard.levels ?? [])
    .map((l) => ({ name: l.name, rank: l.rank, color: l.color }))
    .sort((a, b) => a.rank - b.rank)
}

// ---------------------------------------------------------------------------
// listScorecards — org rollup for the landing page
// ---------------------------------------------------------------------------

export interface ScorecardSummary {
  id: string
  name: string
  description?: string | null
  enabled: boolean
  appliesToKind?: string | null
  levels: LevelDef[]
  rulesCount: number
  /** Distinct entities that have at least one result. */
  entitiesEvaluated: number
  /** Passing result rows over total result rows. */
  passed: number
  total: number
  distribution: LevelBucket[]
  unranked: number
}

/**
 * Aggregate one scorecard's rules + results into a {@link ScorecardSummary}.
 * Pure given its inputs — all I/O happens in the callers.
 */
function summarise(
  scorecard: Scorecard,
  rules: ScorecardRule[],
  results: ScorecardRuleResult[],
): ScorecardSummary {
  const levels = scorecardLevels(scorecard)
  const ruleLite = rules.map((r) => ({ id: r.id, level: r.level }))

  // Group results by entity → set of passed rule IDs.
  const byEntity = new Map<string, Set<string>>()
  let passed = 0
  for (const res of results) {
    const entityId = relId(res.entity)
    const ruleIdRef = relId(res.rule)
    if (!entityId || !ruleIdRef) continue
    if (res.passed) passed++
    let set = byEntity.get(entityId)
    if (!set) {
      set = new Set<string>()
      byEntity.set(entityId, set)
    }
    if (res.passed) set.add(ruleIdRef)
  }

  const entityLevels = [...byEntity.values()].map((passedRuleIds) =>
    computeEntityLevel(levels, ruleLite, passedRuleIds),
  )
  const distribution = buildLevelDistribution(levels, entityLevels)

  return {
    id: scorecard.id,
    name: scorecard.name,
    description: scorecard.description,
    enabled: scorecard.enabled ?? true,
    appliesToKind: scorecard.appliesTo?.kind ?? null,
    levels,
    rulesCount: rules.length,
    entitiesEvaluated: byEntity.size,
    passed,
    total: results.length,
    distribution: distribution.buckets,
    unranked: distribution.unranked,
  }
}

/**
 * List the current user's scorecards with an org-level rollup per scorecard
 * (level distribution + pass ratio). Batches rule/result fetches across all
 * scorecards to avoid N+1 round-trips.
 */
export async function listScorecards(): Promise<ScorecardSummary[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return []

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return []

  const scResult = await payload.find({
    collection: 'scorecards',
    where: { workspace: { in: workspaceIds } },
    sort: 'name',
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })
  const scorecards = scResult.docs
  if (scorecards.length === 0) return []

  const ids = scorecards.map((s) => s.id)
  const [rulesResult, resultsResult] = await Promise.all([
    payload.find({
      collection: 'scorecard-rules',
      where: { scorecard: { in: ids } },
      limit: 5000,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'scorecard-rule-results',
      where: { scorecard: { in: ids } },
      limit: 50000,
      depth: 0,
      overrideAccess: true,
    }),
  ])

  const rulesBySc = new Map<string, ScorecardRule[]>()
  for (const rule of rulesResult.docs) {
    const scId = relId(rule.scorecard)
    if (!scId) continue
    const list = rulesBySc.get(scId) ?? []
    list.push(rule)
    rulesBySc.set(scId, list)
  }
  const resultsBySc = new Map<string, ScorecardRuleResult[]>()
  for (const res of resultsResult.docs) {
    const scId = relId(res.scorecard)
    if (!scId) continue
    const list = resultsBySc.get(scId) ?? []
    list.push(res)
    resultsBySc.set(scId, list)
  }

  return scorecards.map((sc) =>
    summarise(sc, rulesBySc.get(sc.id) ?? [], resultsBySc.get(sc.id) ?? []),
  )
}

// ---------------------------------------------------------------------------
// getScorecardDetail — rules + per-entity results matrix
// ---------------------------------------------------------------------------

export interface EntityRow {
  entityId: string
  entityName: string
  entityKind?: string | null
  level: LevelDef | null
  passed: number
  total: number
  /** Per-rule outcome keyed by rule id. Absent rule id = not evaluated. */
  results: Record<string, { passed: boolean; detail?: string | null }>
}

export interface ScorecardDetail {
  scorecard: Scorecard
  levels: LevelDef[]
  rules: ScorecardRule[]
  rows: EntityRow[]
  summary: ScorecardSummary
  /** Whether the current user may author this scorecard (owner/admin). */
  canManage: boolean
}

/**
 * Full detail for one scorecard: its rules, a per-entity results matrix with
 * each entity's computed level, and the rollup summary. Returns null when the
 * scorecard is missing or outside the user's workspaces (caller → notFound()).
 */
export async function getScorecardDetail(scorecardId: string): Promise<ScorecardDetail | null> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) return null

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return null

  let scorecard: Scorecard
  try {
    scorecard = await payload.findByID({
      collection: 'scorecards',
      id: scorecardId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    return null
  }
  if (!scorecard || !workspaceIds.includes(relId(scorecard.workspace) ?? '')) return null

  const levels = scorecardLevels(scorecard)

  const [rulesResult, resultsResult] = await Promise.all([
    payload.find({
      collection: 'scorecard-rules',
      where: { scorecard: { equals: scorecardId } },
      sort: 'title',
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'scorecard-rule-results',
      where: { scorecard: { equals: scorecardId } },
      limit: 50000,
      depth: 1, // resolve `entity` for name/kind
      overrideAccess: true,
    }),
  ])

  const rules = rulesResult.docs
  // Order rules by ladder rank (rule.level → level rank), then title.
  const rankOf = new Map(levels.map((l) => [l.name, l.rank]))
  rules.sort((a, b) => {
    const ra = a.level ? (rankOf.get(a.level) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    const rb = b.level ? (rankOf.get(b.level) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    return ra - rb || a.title.localeCompare(b.title)
  })
  const ruleLite = rules.map((r) => ({ id: r.id, level: r.level }))

  // Build per-entity rows from results.
  const rowMap = new Map<string, EntityRow>()
  for (const res of resultsResult.docs) {
    const entity = res.entity as CatalogEntity | string
    const entityId = relId(entity)
    const ruleIdRef = relId(res.rule)
    if (!entityId || !ruleIdRef) continue

    let row = rowMap.get(entityId)
    if (!row) {
      const name = typeof entity === 'object' ? entity.name : entityId
      const kind = typeof entity === 'object' ? entity.kind : null
      row = {
        entityId,
        entityName: name,
        entityKind: kind,
        level: null,
        passed: 0,
        total: 0,
        results: {},
      }
      rowMap.set(entityId, row)
    }
    row.results[ruleIdRef] = { passed: res.passed, detail: res.detail }
    row.total++
    if (res.passed) row.passed++
  }

  // Compute each entity's level from its passing rules.
  const rows = [...rowMap.values()]
  for (const row of rows) {
    const passedRuleIds = new Set(
      Object.entries(row.results)
        .filter(([, r]) => r.passed)
        .map(([id]) => id),
    )
    row.level = computeEntityLevel(levels, ruleLite, passedRuleIds)
  }
  rows.sort(
    (a, b) =>
      (b.level?.rank ?? -1) - (a.level?.rank ?? -1) || a.entityName.localeCompare(b.entityName),
  )

  const summary = summarise(scorecard, rules, resultsResult.docs)

  const canManage = await canManageScorecards(payload, uid, relId(scorecard.workspace))

  return { scorecard, levels, rules, rows, summary, canManage }
}

// ---------------------------------------------------------------------------
// getEntityScoreSummary — one entity's scores (catalog integration)
// ---------------------------------------------------------------------------

export interface EntityScorecardScore {
  scorecardId: string
  scorecardName: string
  levels: LevelDef[]
  level: LevelDef | null
  passed: number
  total: number
  rules: Array<{
    ruleId: string
    title: string
    level?: string | null
    type: string
    passed: boolean
    detail?: string | null
  }>
}

export interface EntityScoreSummary {
  scorecards: EntityScorecardScore[]
}

/**
 * Score summary for a single catalog entity, grouped by scorecard, with the
 * computed level per scorecard. Used by the catalog entity scorecards tab and
 * the inline list chip.
 *
 * `userId` is optional: when this runs as a client-invoked server action the
 * caller can't be trusted to supply it, so we fall back to the session user for
 * the workspace boundary.
 */
export async function getEntityScoreSummary(entityId: string): Promise<EntityScoreSummary> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  const empty: EntityScoreSummary = { scorecards: [] }
  if (!uid || !entityId) return empty

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) return empty

  const resultsResult = await payload.find({
    collection: 'scorecard-rule-results',
    where: {
      entity: { equals: entityId },
      workspace: { in: workspaceIds },
    },
    limit: 5000,
    depth: 1, // resolve scorecard (for levels) + rule (for title/level/type)
    overrideAccess: true,
  })

  // Group results by scorecard.
  const groups = new Map<string, { scorecard: Scorecard; results: ScorecardRuleResult[] }>()
  for (const res of resultsResult.docs) {
    const sc = res.scorecard
    if (typeof sc !== 'object' || sc === null) continue
    let group = groups.get(sc.id)
    if (!group) {
      group = { scorecard: sc, results: [] }
      groups.set(sc.id, group)
    }
    group.results.push(res)
  }

  const scorecards: EntityScorecardScore[] = []
  for (const { scorecard, results } of groups.values()) {
    const levels = scorecardLevels(scorecard)
    const ruleLite: { id: string; level?: string | null }[] = []
    const rules: EntityScorecardScore['rules'] = []
    const passedRuleIds = new Set<string>()
    let passed = 0

    for (const res of results) {
      const rule = res.rule
      if (typeof rule !== 'object' || rule === null) continue
      ruleLite.push({ id: rule.id, level: rule.level })
      rules.push({
        ruleId: rule.id,
        title: rule.title,
        level: rule.level,
        type: rule.type,
        passed: res.passed,
        detail: res.detail,
      })
      if (res.passed) {
        passed++
        passedRuleIds.add(rule.id)
      }
    }

    rules.sort((a, b) => a.title.localeCompare(b.title))

    scorecards.push({
      scorecardId: scorecard.id,
      scorecardName: scorecard.name,
      levels,
      level: computeEntityLevel(levels, ruleLite, passedRuleIds),
      passed,
      total: results.length,
      rules,
    })
  }

  scorecards.sort((a, b) => a.scorecardName.localeCompare(b.scorecardName))
  return { scorecards }
}

// ---------------------------------------------------------------------------
// runEvaluation — re-evaluate a scorecard on demand
// ---------------------------------------------------------------------------

export interface EvaluationSummary {
  scorecardId: string
  entitiesEvaluated: number
  rulesEvaluated: number
  resultsWritten: number
}

/**
 * Run (or re-run) evaluation for a scorecard. Verifies the session user is a
 * member of the scorecard's workspace before delegating to the shared
 * evaluation runner. Throws on auth failure so the client surfaces an error.
 */
export async function runEvaluation(scorecardId: string): Promise<EvaluationSummary> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')

  const workspaceIds = await getMemberWorkspaceIds(payload, uid)
  if (workspaceIds.length === 0) throw new Error('No workspace access')

  let scorecard: Scorecard
  try {
    scorecard = await payload.findByID({
      collection: 'scorecards',
      id: scorecardId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Scorecard not found')
  }
  if (!scorecard || !workspaceIds.includes(relId(scorecard.workspace) ?? '')) {
    throw new Error('Scorecard not found')
  }

  return runScorecardEvaluation(payload, scorecardId)
}

// ===========================================================================
// Authoring actions (IDP refocus P2, Option A) — RBAC-gated on workspace
// owner/admin via canManageScorecards. EVERY action resolves the session user,
// determines the target workspace (from input for create; by loading the doc
// for update/delete), and throws BEFORE any write when the check fails. The
// check IS the authz, so the Payload mutations run with overrideAccess: true
// and a client-supplied "canManage" is never trusted.
// ===========================================================================

/** A maturity-ladder rung as authored in the level editor. */
export interface LevelInput {
  name: string
  rank: number
  color?: string | null
}

export interface ManageableWorkspace {
  id: string
  name: string
}

export interface CreateScorecardInput {
  workspace: string
  name: string
  description?: string | null
  appliesToKind?: string | null
  levels?: LevelInput[]
}

export interface UpdateScorecardInput {
  name?: string
  description?: string | null
  appliesToKind?: string | null
  levels?: LevelInput[]
  enabled?: boolean
}

export interface RuleInput {
  scorecard: string
  title: string
  description?: string | null
  level?: string | null
  type: ScorecardRule['type']
  expression: Record<string, unknown>
  weight?: number
}

export interface UpdateRuleInput {
  title?: string
  description?: string | null
  level?: string | null
  type?: ScorecardRule['type']
  expression?: Record<string, unknown>
  weight?: number
}

/** Resolve + assert the session user; throws when unauthenticated. */
async function requireUserId(): Promise<string> {
  const uid = (await getCurrentUser())?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

/** Throw unless the user may author scorecards in `workspaceId`. */
async function assertCanManage(
  payload: Payload,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId || !(await canManageScorecards(payload, userId, workspaceId))) {
    throw new Error('You do not have permission to manage scorecards in this workspace.')
  }
}

/** Normalise authored levels into clean rungs (drop blank-named rows). */
function sanitiseLevels(levels?: LevelInput[]): LevelInput[] {
  return (levels ?? [])
    .filter((l) => l && typeof l.name === 'string' && l.name.trim().length > 0)
    .map((l) => ({
      name: l.name.trim(),
      rank: Number.isFinite(l.rank) ? l.rank : 0,
      color: l.color?.trim() ? l.color.trim() : undefined,
    }))
}

/**
 * Workspaces where the user is an active owner/admin — the source list for the
 * New-scorecard workspace picker and the list page's "can create" gate.
 */
export async function getManageableWorkspaces(): Promise<ManageableWorkspace[]> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
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

// --- scorecard CRUD ---------------------------------------------------------

export async function createScorecard(input: CreateScorecardInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()
  await assertCanManage(payload, uid, input.workspace)

  if (!input.name?.trim()) throw new Error('A scorecard name is required.')

  const created = await payload.create({
    collection: 'scorecards',
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      workspace: input.workspace,
      appliesTo: input.appliesToKind
        ? { kind: input.appliesToKind as NonNullable<Scorecard['appliesTo']>['kind'] }
        : undefined,
      levels: sanitiseLevels(input.levels),
      enabled: true,
    },
    overrideAccess: true,
  })

  return { id: created.id }
}

export async function updateScorecard(
  scorecardId: string,
  input: UpdateScorecardInput,
): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let scorecard: Scorecard
  try {
    scorecard = await payload.findByID({
      collection: 'scorecards',
      id: scorecardId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Scorecard not found')
  }
  await assertCanManage(payload, uid, relId(scorecard.workspace))

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('A scorecard name is required.')
    data.name = input.name.trim()
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null
  if (input.appliesToKind !== undefined) {
    data.appliesTo = input.appliesToKind
      ? { kind: input.appliesToKind as NonNullable<Scorecard['appliesTo']>['kind'] }
      : { kind: null }
  }
  if (input.levels !== undefined) data.levels = sanitiseLevels(input.levels)
  if (input.enabled !== undefined) data.enabled = input.enabled

  const updated = await payload.update({
    collection: 'scorecards',
    id: scorecardId,
    data,
    overrideAccess: true,
  })

  if (input.enabled === false) {
    await clearScorecardProjections(payload, scorecardId, relId(scorecard.workspace) as string)
  } else if (
    input.enabled === true ||
    input.appliesToKind !== undefined ||
    input.levels !== undefined
  ) {
    await runScorecardEvaluation(payload, scorecardId)
  }

  return { id: updated.id }
}

export async function deleteScorecard(scorecardId: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let scorecard: Scorecard
  try {
    scorecard = await payload.findByID({
      collection: 'scorecards',
      id: scorecardId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Scorecard not found')
  }
  const workspaceId = relId(scorecard.workspace) as string
  await assertCanManage(payload, uid, workspaceId)

  await clearScorecardProjections(payload, scorecardId, workspaceId)

  const initiativeIds: string[] = []
  for (let page = 1; ; page++) {
    const initiatives = await payload.find({
      collection: 'initiatives',
      where: { scorecard: { equals: scorecardId } },
      limit: 100,
      page,
      depth: 0,
      overrideAccess: true,
    })
    initiativeIds.push(...initiatives.docs.map((initiative) => initiative.id))
    if (!initiatives.hasNextPage) break
  }
  if (initiativeIds.length > 0) {
    await payload.delete({
      collection: 'initiative-action-items',
      where: { initiative: { in: initiativeIds } },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'initiatives',
      where: { id: { in: initiativeIds } },
      overrideAccess: true,
    })
  }
  await payload.delete({
    collection: 'score-snapshots',
    where: { scorecard: { equals: scorecardId } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'scorecard-rules',
    where: { scorecard: { equals: scorecardId } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'scorecards',
    id: scorecardId,
    overrideAccess: true,
  })

  return { id: scorecardId }
}

// --- rule CRUD --------------------------------------------------------------

export async function createRule(input: RuleInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  // The parent scorecard determines the workspace (denormalised onto the rule).
  let scorecard: Scorecard
  try {
    scorecard = await payload.findByID({
      collection: 'scorecards',
      id: input.scorecard,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Scorecard not found')
  }
  const workspaceId = relId(scorecard.workspace)
  await assertCanManage(payload, uid, workspaceId)

  if (!input.title?.trim()) throw new Error('A rule title is required.')
  const exprError = validateExpression(input.type, input.expression)
  if (exprError) throw new Error(exprError)

  const created = await payload.create({
    collection: 'scorecard-rules',
    data: {
      scorecard: input.scorecard,
      workspace: workspaceId as string,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      level: input.level?.trim() || undefined,
      type: input.type,
      expression: input.expression,
      weight: typeof input.weight === 'number' ? input.weight : 1,
    },
    overrideAccess: true,
  })

  await runScorecardEvaluation(payload, input.scorecard)

  return { id: created.id }
}

export async function updateRule(ruleId: string, input: UpdateRuleInput): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let rule: ScorecardRule
  try {
    rule = await payload.findByID({
      collection: 'scorecard-rules',
      id: ruleId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Rule not found')
  }
  await assertCanManage(payload, uid, relId(rule.workspace))

  const data: Record<string, unknown> = {}
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new Error('A rule title is required.')
    data.title = input.title.trim()
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null
  if (input.level !== undefined) data.level = input.level?.trim() || null
  if (input.weight !== undefined) data.weight = input.weight

  // Type/expression validate together against the effective type.
  if (input.expression !== undefined || input.type !== undefined) {
    const effectiveType = input.type ?? rule.type
    const expression = input.expression ?? rule.expression
    const exprError = validateExpression(effectiveType, expression)
    if (exprError) throw new Error(exprError)
    if (input.type !== undefined) data.type = input.type
    if (input.expression !== undefined) data.expression = input.expression
  }

  const updated = await payload.update({
    collection: 'scorecard-rules',
    id: ruleId,
    data,
    overrideAccess: true,
  })

  await runScorecardEvaluation(payload, relId(rule.scorecard) as string)

  return { id: updated.id }
}

export async function deleteRule(ruleId: string): Promise<{ id: string }> {
  const payload = await getPayload({ config })
  const uid = await requireUserId()

  let rule: ScorecardRule
  try {
    rule = await payload.findByID({
      collection: 'scorecard-rules',
      id: ruleId,
      depth: 0,
      overrideAccess: true,
    })
  } catch {
    throw new Error('Rule not found')
  }
  await assertCanManage(payload, uid, relId(rule.workspace))

  // Remove this rule's result rows alongside it.
  await payload.delete({
    collection: 'scorecard-rule-results',
    where: { rule: { equals: ruleId } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'scorecard-rules',
    id: ruleId,
    overrideAccess: true,
  })

  await runScorecardEvaluation(payload, relId(rule.scorecard) as string)

  return { id: ruleId }
}
