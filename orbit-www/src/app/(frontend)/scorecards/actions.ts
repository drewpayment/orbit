'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'
import type { Scorecard, ScorecardRule, ScorecardRuleResult, CatalogEntity } from '@/payload-types'
import { runScorecardEvaluation } from '@/lib/scorecards/evaluate'
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

  return memberships.docs.map((m) => (typeof m.workspace === 'string' ? m.workspace : m.workspace.id))
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
export async function listScorecards(userId?: string): Promise<ScorecardSummary[]> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
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
}

/**
 * Full detail for one scorecard: its rules, a per-entity results matrix with
 * each entity's computed level, and the rollup summary. Returns null when the
 * scorecard is missing or outside the user's workspaces (caller → notFound()).
 */
export async function getScorecardDetail(
  userId: string | undefined,
  scorecardId: string,
): Promise<ScorecardDetail | null> {
  const payload = await getPayload({ config })
  const uid = userId ?? (await getCurrentUser())?.id
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
  rows.sort((a, b) => (b.level?.rank ?? -1) - (a.level?.rank ?? -1) || a.entityName.localeCompare(b.entityName))

  const summary = summarise(scorecard, rules, resultsResult.docs)

  return { scorecard, levels, rules, rows, summary }
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
export async function getEntityScoreSummary(
  userId: string | undefined,
  entityId: string,
): Promise<EntityScoreSummary> {
  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id ?? userId
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
