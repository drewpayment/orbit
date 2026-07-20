import type { Payload, Where } from 'payload'
import type {
  CatalogEntity,
  CatalogRelation,
  EntityScore,
  Scorecard,
  ScorecardRule,
  ScorecardRuleResult,
} from '@/payload-types'
import type { EntityKind } from '@/collections/catalog/constants'
import { resolveEntityType } from '@/lib/catalog/entity-types'
import {
  computeScorecardScore,
  computeOverallScore,
  computeGoldenPathAlignment,
  type WeightedRuleResult,
} from './scoring'

/**
 * Scorecard rule-evaluation engine (IDP refocus P2; entity-score rule type +
 * recompute pipeline added by Entity Scores & Golden Paths,
 * docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * Rules are DATA, not code: each scorecard-rule carries a JSON `expression`
 * interpreted here per `type`. The four shapes (documented on the
 * ScorecardRules collection) are:
 *
 *   - field-presence: { path, op: 'exists' | 'not-empty' }
 *   - relation-check: { relationType, direction?: 'from'|'to'|'either',
 *                       targetKind?, min?(default 1) }
 *   - threshold:      { path, op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in', value }
 *   - entity-score:   { target: 'self'|'related', scoreScope?: 'overall'|
 *                       'scorecard' (default 'overall'), scorecardId?,
 *                       relationType?, direction?, targetKind? (target=related
 *                       selectors), aggregate?: 'min'|'avg'|'max' (default
 *                       'min'), op: 'gte'|'gt'|'lte'|'lt'|'eq', value } —
 *                       compiles the entity's own or related entities' LATEST
 *                       STORED entity-scores rows (never a live recompute).
 *
 * `path` is a dotted accessor into the entity (e.g. 'owner',
 * 'metadata.costCenter'). The pure functions here are fully unit-tested; the
 * orchestrator (`runScorecardEvaluation`) is the future Temporal/Go entry point
 * and idempotently writes scorecard-rule-results + entity-scores.
 */

/** A stored entity-scores lookup for one entity: its overall score plus a
 *  per-scorecard breakdown. Built by the orchestrator from the LATEST stored
 *  rows (never a live recompute) and handed to `evaluateRule` via
 *  `EvalContext.scores` so `entity-score` rules stay pure/unit-testable. */
export type EntityScoreLookup = {
  overall: number | null
  byScorecard: Record<string, number>
}

export type EvalContext = {
  entity: CatalogEntity
  relations: CatalogRelation[]
  /** Latest stored entity-scores, keyed by entity id — the entity under
   *  evaluation plus any related entities an `entity-score` rule might read.
   *  Only `entity-score` rules consult this; absent/undefined is fine for the
   *  other rule types. */
  scores?: Record<string, EntityScoreLookup>
  /** Each entity's type `scoringWeight`, keyed by entity id — used by
   *  `entity-score` rules' weighted-average aggregation over related
   *  entities. Missing entries default to weight 1 (see `evalEntityScore`). */
  weights?: Record<string, number>
}

export interface RuleEvalResult {
  passed: boolean
  detail: string
}

// --- expression shapes (interpreted, not stored as types) -------------------

type FieldPresenceExpr = { path: string; op: 'exists' | 'not-empty' }
type ThresholdOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
type ThresholdExpr = { path: string; op: ThresholdOp; value: unknown }
type RelationDirection = 'from' | 'to' | 'either'
type RelationCheckExpr = {
  relationType: string
  direction?: RelationDirection
  targetKind?: string
  min?: number
}
type ScoreScope = 'overall' | 'scorecard'
type AggregateOp = 'min' | 'avg' | 'max'
type CompareOp = 'gte' | 'gt' | 'lte' | 'lt' | 'eq'
type EntityScoreExpr = {
  target: 'self' | 'related'
  scoreScope?: ScoreScope
  scorecardId?: string
  // target='related' selectors — which related entities' scores compile.
  relationType?: string
  direction?: RelationDirection
  targetKind?: string
  aggregate?: AggregateOp
  op: CompareOp
  value: number
}

// --- helpers ----------------------------------------------------------------

/** Read a dotted path (e.g. 'metadata.costCenter') off an object, or undefined. */
function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

/** Empty = null/undefined, blank string, empty array, or empty plain object. */
function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

/** Loose equality: numeric compare when either side is a number, else strict. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isNaN(na) || Number.isNaN(nb)) return false
    return na === nb
  }
  return a === b
}

/** Normalise a relationship end (id string or populated doc) to its id. */
function relEndId(end: string | CatalogEntity | null | undefined): string | null {
  if (end == null) return null
  return typeof end === 'string' ? end : end.id
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function fail(detail: string): RuleEvalResult {
  return { passed: false, detail }
}

/** Numeric comparison shared by `threshold`'s gt/gte/lt/lte/eq and `entity-score`'s op. */
function compareNumeric(op: string, a: number, b: number): boolean {
  switch (op) {
    case 'gte':
      return a >= b
    case 'gt':
      return a > b
    case 'lte':
      return a <= b
    case 'lt':
      return a < b
    case 'eq':
      return a === b
    default:
      return false
  }
}

// --- evaluateRule -----------------------------------------------------------

export function evaluateRule(rule: ScorecardRule, ctx: EvalContext): RuleEvalResult {
  const expr = rule.expression
  if (!isRecord(expr)) {
    return fail(`Rule "${rule.title}" has a malformed expression (expected an object).`)
  }

  switch (rule.type) {
    case 'field-presence':
      return evalFieldPresence(expr as unknown as FieldPresenceExpr, ctx)
    case 'relation-check':
      return evalRelationCheck(expr as unknown as RelationCheckExpr, ctx)
    case 'threshold':
      return evalThreshold(expr as unknown as ThresholdExpr, ctx)
    case 'entity-score':
      return evalEntityScore(expr as unknown as EntityScoreExpr, ctx)
    default:
      return fail(`Unknown rule type "${rule.type}".`)
  }
}

function evalFieldPresence(expr: FieldPresenceExpr, ctx: EvalContext): RuleEvalResult {
  const { path, op } = expr
  if (typeof path !== 'string' || !path) {
    return fail('field-presence: missing `path`.')
  }
  const value = getPath(ctx.entity, path)

  if (op === 'exists') {
    const passed = value !== undefined && value !== null
    return {
      passed,
      detail: passed ? `\`${path}\` is set.` : `\`${path}\` is not set.`,
    }
  }
  if (op === 'not-empty') {
    const passed = !isEmptyValue(value)
    return {
      passed,
      detail: passed ? `\`${path}\` is present and non-empty.` : `\`${path}\` is empty or missing.`,
    }
  }
  return fail(`field-presence: unknown op "${op}".`)
}

function evalThreshold(expr: ThresholdExpr, ctx: EvalContext): RuleEvalResult {
  const { path, op, value: expected } = expr
  if (typeof path !== 'string' || !path) {
    return fail('threshold: missing `path`.')
  }
  const actual = getPath(ctx.entity, path)
  const show = (v: unknown) => (v === undefined ? 'undefined' : JSON.stringify(v))

  switch (op) {
    case 'eq': {
      const passed = valuesEqual(actual, expected)
      return {
        passed,
        detail: `\`${path}\` (${show(actual)}) ${passed ? '==' : '!='} ${show(expected)}.`,
      }
    }
    case 'neq': {
      const passed = !valuesEqual(actual, expected)
      return {
        passed,
        detail: `\`${path}\` (${show(actual)}) ${passed ? '!=' : '=='} ${show(expected)}.`,
      }
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const na = Number(actual)
      const nb = Number(expected)
      if (Number.isNaN(na) || Number.isNaN(nb)) {
        return fail(
          `threshold: \`${path}\` (${show(actual)}) or value (${show(expected)}) is not numeric for op "${op}".`,
        )
      }
      const passed =
        op === 'gt' ? na > nb : op === 'gte' ? na >= nb : op === 'lt' ? na < nb : na <= nb
      return {
        passed,
        detail: `\`${path}\` (${na}) ${passed ? 'satisfies' : 'fails'} ${op} ${nb}.`,
      }
    }
    case 'in': {
      if (!Array.isArray(expected)) {
        return fail(`threshold: op "in" requires \`value\` to be an array, got ${show(expected)}.`)
      }
      const candidates = Array.isArray(actual) ? actual : [actual]
      const passed = candidates.some((c) => expected.some((e) => valuesEqual(c, e)))
      return {
        passed,
        detail: passed
          ? `\`${path}\` (${show(actual)}) is in ${show(expected)}.`
          : `\`${path}\` (${show(actual)}) is not in ${show(expected)}.`,
      }
    }
    default:
      return fail(`threshold: unknown op "${op}".`)
  }
}

/**
 * Walk `ctx.relations` and return the "other end" of every relation touching
 * the entity under evaluation that matches `relationType` (or any type, when
 * omitted — used by golden-path/entity-score lookups that don't filter by
 * type), `direction`, and an optional `targetKind`. Shared by
 * `evalRelationCheck` (which just counts the result) and `evalEntityScore`'s
 * target='related' selector (which reads scores for each returned end).
 *
 * A target-kind filter requires the other end to be populated (depth ≥ 1) so
 * its `kind` can be read; an unpopulated id cannot match and is skipped.
 */
function collectRelatedEnds(
  ctx: EvalContext,
  relationType: string | undefined,
  direction: RelationDirection,
  targetKind?: string,
): (string | CatalogEntity)[] {
  const entityId = ctx.entity.id
  const ends: (string | CatalogEntity)[] = []
  for (const rel of ctx.relations) {
    if (relationType && rel.type !== relationType) continue

    const fromId = relEndId(rel.from)
    const toId = relEndId(rel.to)

    // Determine whether this relation matches the requested direction relative
    // to the entity under evaluation, and which end is the "other" side.
    let otherEnd: string | CatalogEntity | null = null
    if (direction === 'from') {
      if (fromId !== entityId) continue
      otherEnd = rel.to
    } else if (direction === 'to') {
      if (toId !== entityId) continue
      otherEnd = rel.from
    } else {
      // either
      if (fromId === entityId) otherEnd = rel.to
      else if (toId === entityId) otherEnd = rel.from
      else continue
    }

    if (targetKind) {
      if (typeof otherEnd !== 'object' || otherEnd == null) continue
      if (otherEnd.kind !== targetKind) continue
    }

    if (otherEnd != null) ends.push(otherEnd)
  }
  return ends
}

function evalRelationCheck(expr: RelationCheckExpr, ctx: EvalContext): RuleEvalResult {
  const { relationType, targetKind } = expr
  const direction: RelationDirection = expr.direction ?? 'either'
  const min = typeof expr.min === 'number' ? expr.min : 1

  if (typeof relationType !== 'string' || !relationType) {
    return fail('relation-check: missing `relationType`.')
  }

  const count = collectRelatedEnds(ctx, relationType, direction, targetKind).length
  const passed = count >= min
  const kindNote = targetKind ? ` to ${targetKind}` : ''
  return {
    passed,
    detail: `Found ${count} \`${relationType}\` relation(s)${kindNote} (${direction}); need ≥ ${min}.`,
  }
}

function evalEntityScore(expr: EntityScoreExpr, ctx: EvalContext): RuleEvalResult {
  const { target, op, value } = expr
  const scoreScope: ScoreScope = expr.scoreScope ?? 'overall'
  const aggregate: AggregateOp = expr.aggregate ?? 'min'

  if (target !== 'self' && target !== 'related') {
    return fail(`entity-score: unknown target "${String(target)}" (expected "self" or "related").`)
  }
  if (scoreScope === 'scorecard' && (typeof expr.scorecardId !== 'string' || !expr.scorecardId)) {
    return fail('entity-score: scoreScope "scorecard" requires `scorecardId`.')
  }
  if (typeof op !== 'string' || !['gte', 'gt', 'lte', 'lt', 'eq'].includes(op)) {
    return fail(`entity-score: unknown op "${String(op)}".`)
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fail(`entity-score: \`value\` must be a number, got ${JSON.stringify(value)}.`)
  }

  const scores = ctx.scores ?? {}
  const readScore = (entityId: string): number | null => {
    const lookup = scores[entityId]
    if (!lookup) return null
    if (scoreScope === 'overall') return lookup.overall
    const byScorecard = lookup.byScorecard[expr.scorecardId as string]
    return typeof byScorecard === 'number' ? byScorecard : null
  }
  const scopeNote = scoreScope === 'scorecard' ? `scorecard ${expr.scorecardId}` : 'overall'

  let subjectScore: number | null
  let subjectLabel: string

  if (target === 'self') {
    subjectScore = readScore(ctx.entity.id)
    subjectLabel = `this entity's ${scopeNote} score`
    if (subjectScore == null) {
      return fail(`entity-score: no stored ${scopeNote} score found for this entity yet.`)
    }
  } else {
    // target === 'related'
    if (typeof expr.relationType !== 'string' || !expr.relationType) {
      return fail('entity-score: target "related" requires `relationType`.')
    }
    const direction: RelationDirection = expr.direction ?? 'either'
    const relatedIds = [
      ...new Set(
        collectRelatedEnds(ctx, expr.relationType, direction, expr.targetKind).map(
          (end) => relEndId(end) as string,
        ),
      ),
    ]
    const kindNote = expr.targetKind ? ` to ${expr.targetKind}` : ''
    if (relatedIds.length === 0) {
      return fail(
        `entity-score: no related entities found via \`${expr.relationType}\`${kindNote} (${direction}).`,
      )
    }

    const found: { score: number; weight: number }[] = []
    let missing = 0
    for (const id of relatedIds) {
      const s = readScore(id)
      if (s == null) {
        missing++
        continue
      }
      found.push({ score: s, weight: ctx.weights?.[id] ?? 1 })
    }

    if (found.length === 0) {
      return fail(
        `entity-score: none of the ${relatedIds.length} related entit${relatedIds.length === 1 ? 'y' : 'ies'} (\`${expr.relationType}\`${kindNote}, ${direction}) have a stored ${scopeNote} score yet.`,
      )
    }

    if (aggregate === 'min') {
      subjectScore = Math.min(...found.map((f) => f.score))
    } else if (aggregate === 'max') {
      subjectScore = Math.max(...found.map((f) => f.score))
    } else {
      // Weighted average — each related entity's type `scoringWeight`.
      const totalWeight = found.reduce((sum, f) => sum + f.weight, 0)
      subjectScore =
        totalWeight > 0
          ? Math.round(found.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight)
          : Math.round(found.reduce((sum, f) => sum + f.score, 0) / found.length)
    }

    const missingNote = missing > 0 ? `, ${missing} missing/excluded` : ''
    subjectLabel = `${aggregate} of ${found.length} related \`${expr.relationType}\`${kindNote} ${scopeNote} score(s)${missingNote}`
  }

  const passed = compareNumeric(op, subjectScore as number, value)
  return {
    passed,
    detail: `${subjectLabel} (${subjectScore}) ${passed ? 'satisfies' : 'fails'} ${op} ${value}.`,
  }
}

// --- computeEntityLevel -----------------------------------------------------

/**
 * Given a scorecard's `levels` (lowest rank first) and the pass/fail of every
 * rule (tagged with a level name or untagged), return the highest ladder rung
 * fully achieved.
 *
 * Ladder semantics:
 *  - Untagged rules are the "base": ALL must pass to achieve any level.
 *  - A level at rank R is achieved iff every rule tagged with that level passes
 *    AND every lower-ranked level is achieved (monotonic — a failing lower rung
 *    blocks all higher ones).
 *  - A level with no rules tagged passes through (achieved if lower ones are).
 */
export function computeEntityLevel(
  levels: { name: string; rank: number }[],
  rulesWithPass: { level?: string | null; passed: boolean }[],
): { levelName: string | null; rank: number } {
  const none = { levelName: null as string | null, rank: 0 }
  if (!levels.length) return none

  const baseRules = rulesWithPass.filter((r) => !r.level)
  if (!baseRules.every((r) => r.passed)) return none

  const sorted = [...levels].sort((a, b) => a.rank - b.rank)
  let achieved = none
  for (const lvl of sorted) {
    const lvlRules = rulesWithPass.filter((r) => r.level === lvl.name)
    if (lvlRules.every((r) => r.passed)) {
      achieved = { levelName: lvl.name, rank: lvl.rank }
    } else {
      break
    }
  }
  return achieved
}

// --- orchestration ----------------------------------------------------------

const PAGE_SIZE = 100

/** Idempotency key for a result row: (scorecard, rule, entity). */
function ruleResultWhere(scorecardId: string, ruleId: string, entityId: string): Where {
  return {
    and: [
      { scorecard: { equals: scorecardId } },
      { rule: { equals: ruleId } },
      { entity: { equals: entityId } },
    ],
  }
}

/**
 * Upsert a single scorecard-rule-result row, keyed on (scorecard, rule, entity).
 * Find existing → update; else create. Always uses overrideAccess (the
 * collection forbids direct user writes). Returns the row id.
 */
export async function upsertRuleResult(
  payload: Payload,
  args: {
    workspaceId: string
    scorecardId: string
    ruleId: string
    entityId: string
    passed: boolean
    detail: string
  },
): Promise<string> {
  const data = {
    workspace: args.workspaceId,
    scorecard: args.scorecardId,
    rule: args.ruleId,
    entity: args.entityId,
    passed: args.passed,
    detail: args.detail,
    evaluatedAt: new Date().toISOString(),
  }

  const existing = await payload.find({
    collection: 'scorecard-rule-results',
    where: ruleResultWhere(args.scorecardId, args.ruleId, args.entityId),
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    const updated = await payload.update({
      collection: 'scorecard-rule-results',
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    })
    return updated.id
  }

  try {
    const created = await payload.create({
      collection: 'scorecard-rule-results',
      data,
      overrideAccess: true,
    })
    return created.id
  } catch (error) {
    // A concurrent evaluator may have won the unique-key race after our find.
    const raced = await payload.find({
      collection: 'scorecard-rule-results',
      where: ruleResultWhere(args.scorecardId, args.ruleId, args.entityId),
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (raced.docs.length === 0) throw error
    const updated = await payload.update({
      collection: 'scorecard-rule-results',
      id: raced.docs[0].id,
      data,
      overrideAccess: true,
    })
    return updated.id
  }
}

function relIdOf(v: string | { id: string }): string {
  return typeof v === 'string' ? v : v.id
}

/**
 * Remove materialised results that are no longer part of the scorecard's
 * current rule/entity cross-product. This is intentionally run before score
 * recomputation so changed `appliesTo` filters and deleted rules cannot keep
 * influencing scores indefinitely.
 */
async function reconcileScorecardResults(
  payload: Payload,
  scorecardId: string,
  ruleIds: Set<string>,
  entityIds: Set<string>,
): Promise<void> {
  const rows: ScorecardRuleResult[] = []
  for (let page = 1; ; page++) {
    const result = await payload.find({
      collection: 'scorecard-rule-results',
      where: { scorecard: { equals: scorecardId } },
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })
    rows.push(...(result.docs as ScorecardRuleResult[]))
    if (!result.hasNextPage) break
  }

  const seen = new Set<string>()
  const staleIds: string[] = []
  for (const row of rows) {
    const ruleId = relIdOf(row.rule as string | { id: string })
    const entityId = relIdOf(row.entity as string | { id: string })
    const pair = `${ruleId}:${entityId}`
    if (!ruleIds.has(ruleId) || !entityIds.has(entityId) || seen.has(pair)) {
      staleIds.push(row.id)
    } else {
      seen.add(pair)
    }
  }

  if (staleIds.length > 0) {
    await payload.delete({
      collection: 'scorecard-rule-results',
      where: { id: { in: staleIds } },
      overrideAccess: true,
    })
  }
}

// --- entity-scores recompute -------------------------------------------------

/** Idempotency key for an entity-scores row: (entity, scope[, scorecard]). */
function entityScoreWhere(
  entityId: string,
  scope: 'scorecard' | 'overall',
  scorecardId?: string,
): Where {
  return {
    and: [
      { entity: { equals: entityId } },
      { scope: { equals: scope } },
      scope === 'scorecard'
        ? { scorecard: { equals: scorecardId } }
        : { scorecard: { exists: false } },
    ],
  }
}

/**
 * Upsert a single entity-scores row, keyed on (entity, scope[, scorecard]).
 * Find existing → update; else create. Always uses overrideAccess (the
 * collection forbids direct user writes). Returns the row id.
 */
async function upsertEntityScore(
  payload: Payload,
  args: {
    workspaceId: string
    entityId: string
    scope: 'scorecard' | 'overall'
    scorecardId?: string
    score: number
    levelName?: string | null
    levelRank?: number | null
    passedRules?: number
    totalRules?: number
    weightedPoints?: number
    maxPoints?: number
    baseValue?: number
    goldenPathAlignment?: number
  },
): Promise<string> {
  const data = {
    workspace: args.workspaceId,
    entity: args.entityId,
    scope: args.scope,
    scorecard: args.scope === 'scorecard' ? args.scorecardId : null,
    score: args.score,
    levelName: args.levelName ?? null,
    levelRank: args.levelRank ?? null,
    passedRules: args.passedRules ?? null,
    totalRules: args.totalRules ?? null,
    weightedPoints: args.weightedPoints ?? null,
    maxPoints: args.maxPoints ?? null,
    baseValue: args.baseValue ?? null,
    goldenPathAlignment: args.goldenPathAlignment ?? null,
    evaluatedAt: new Date().toISOString(),
  }

  const existing = await payload.find({
    collection: 'entity-scores',
    where: entityScoreWhere(args.entityId, args.scope, args.scorecardId),
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    const updated = await payload.update({
      collection: 'entity-scores',
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    })
    return updated.id
  }

  try {
    const created = await payload.create({
      collection: 'entity-scores',
      data,
      overrideAccess: true,
    })
    return created.id
  } catch (error) {
    const raced = await payload.find({
      collection: 'entity-scores',
      where: entityScoreWhere(args.entityId, args.scope, args.scorecardId),
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (raced.docs.length === 0) throw error
    const updated = await payload.update({
      collection: 'entity-scores',
      id: raced.docs[0].id,
      data,
      overrideAccess: true,
    })
    return updated.id
  }
}

/**
 * Recompute every entity-scores row for a single entity: one `scope:
 * 'scorecard'` row per scorecard that has actually produced
 * scorecard-rule-results for it (the entity-selection/appliesTo filtering
 * already happened when those results were written, so grouping by the
 * stored results — rather than re-querying every scorecard's appliesTo — is
 * both simpler and correct), plus one `scope: 'overall'` row.
 *
 * Golden-path alignment reuses `evalRelationCheck`/`evalFieldPresence`
 * against the entity's type definition's `requiredRelations` +
 * `requiredMetadata`. Overall score falls back to the type's `baseValue` when
 * no scorecard applies — the coverage-invariant fallback.
 */
async function recomputeEntityScore(
  payload: Payload,
  workspaceId: string,
  entity: CatalogEntity,
): Promise<void> {
  const entityId = entity.id

  const resultsRes = await payload.find({
    collection: 'scorecard-rule-results',
    where: { and: [{ workspace: { equals: workspaceId } }, { entity: { equals: entityId } }] },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const results = resultsRes.docs as ScorecardRuleResult[]

  const byScorecard = new Map<string, ScorecardRuleResult[]>()
  for (const r of results) {
    const scorecardId = relIdOf(r.scorecard as string | { id: string })
    const list = byScorecard.get(scorecardId) ?? []
    list.push(r)
    byScorecard.set(scorecardId, list)
  }

  const scorecardScores: number[] = []
  const materialisedScorecardIds = new Set<string>()

  for (const [scorecardId, resultRows] of byScorecard) {
    const rulesRes = await payload.find({
      collection: 'scorecard-rules',
      where: { scorecard: { equals: scorecardId } },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    const ruleById = new Map((rulesRes.docs as ScorecardRule[]).map((r) => [r.id, r]))

    const weighted: WeightedRuleResult[] = []
    const rulesWithPass: { level?: string | null; passed: boolean }[] = []
    for (const row of resultRows) {
      const ruleId = relIdOf(row.rule as string | { id: string })
      const rule = ruleById.get(ruleId)
      if (!rule) continue
      const weight =
        typeof rule.weight === 'number' && Number.isFinite(rule.weight) ? rule.weight : 1
      weighted.push({ weight, passed: row.passed })
      rulesWithPass.push({ level: rule.level ?? null, passed: row.passed })
    }

    const scoreResult = computeScorecardScore(weighted)
    // No scoreable rules right now (e.g. all 0-weight) — nothing to write.
    if (!scoreResult) continue

    let scorecard: Scorecard
    try {
      scorecard = (await payload.findByID({
        collection: 'scorecards',
        id: scorecardId,
        depth: 0,
        overrideAccess: true,
      })) as Scorecard
    } catch {
      continue
    }
    if (scorecard.enabled === false) continue
    const level = computeEntityLevel(
      (scorecard.levels ?? []).map((l) => ({ name: l.name, rank: l.rank })),
      rulesWithPass,
    )

    await upsertEntityScore(payload, {
      workspaceId,
      entityId,
      scope: 'scorecard',
      scorecardId,
      score: scoreResult.score,
      levelName: level.levelName,
      levelRank: level.rank,
      passedRules: scoreResult.passedRules,
      totalRules: scoreResult.totalRules,
      weightedPoints: scoreResult.weightedPoints,
      maxPoints: scoreResult.maxPoints,
    })
    materialisedScorecardIds.add(scorecardId)
    scorecardScores.push(scoreResult.score)
  }

  // A previous evaluation may have materialised a scorecard row that no
  // longer has valid results (rule deletion, appliesTo change, or disable).
  const existingScorecardRows = await payload.find({
    collection: 'entity-scores',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { entity: { equals: entityId } },
        { scope: { equals: 'scorecard' } },
      ],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const staleScoreIds = (existingScorecardRows.docs as EntityScore[])
    .filter((row) => {
      if (!row.scorecard) return true
      return !materialisedScorecardIds.has(relIdOf(row.scorecard as string | { id: string }))
    })
    .map((row) => row.id)
  if (staleScoreIds.length > 0) {
    await payload.delete({
      collection: 'entity-scores',
      where: { id: { in: staleScoreIds } },
      overrideAccess: true,
    })
  }

  // Golden-path alignment against the entity's type definition — reuses the
  // field-presence/relation-check evaluators against a synthetic ctx.
  const typeDef = await resolveEntityType(payload, workspaceId, entity.kind as EntityKind)
  const relsRes = await payload.find({
    collection: 'catalog-relations',
    where: { or: [{ from: { equals: entityId } }, { to: { equals: entityId } }] },
    limit: 1000,
    depth: 1,
    overrideAccess: true,
  })
  const ctx: EvalContext = { entity, relations: relsRes.docs as CatalogRelation[] }

  let met = 0
  for (const rel of typeDef.goldenPath.requiredRelations) {
    const res = evalRelationCheck(
      {
        relationType: rel.relationType,
        direction: rel.direction,
        targetKind: rel.targetKind ?? undefined,
        min: rel.min,
      },
      ctx,
    )
    if (res.passed) met++
  }
  for (const md of typeDef.goldenPath.requiredMetadata) {
    const res = evalFieldPresence({ path: md.path, op: 'exists' }, ctx)
    if (res.passed) met++
  }
  const expected =
    typeDef.goldenPath.requiredRelations.length + typeDef.goldenPath.requiredMetadata.length
  const goldenPathAlignment = computeGoldenPathAlignment({ met, expected })

  const overall = computeOverallScore({ scorecardScores, baseValue: typeDef.baseValue })

  await upsertEntityScore(payload, {
    workspaceId,
    entityId,
    scope: 'overall',
    score: overall,
    baseValue: typeDef.baseValue,
    goldenPathAlignment,
  })
}

/**
 * Coverage invariant (acceptance criterion #1): upsert an `overall`
 * entity-scores row for EVERY catalog entity in the workspace — entities no
 * scorecard touches fall back to their type's `baseValue`
 * (`recomputeEntityScore` / `computeOverallScore` handle the fallback).
 * Also upserts `scorecard`-scope rows for every scorecard that has produced
 * results for a given entity. Called from `runScorecardEvaluation` (to fold a
 * fresh evaluation into stored scores) and from the
 * `/api/internal/scorecards/recompute-scores` backfill endpoint.
 */
export async function recomputeWorkspaceScores(
  payload: Payload,
  workspaceId: string,
  options: { captureSnapshots?: boolean } = {},
): Promise<{ entitiesScored: number }> {
  let entitiesScored = 0

  for (let page = 1; ; page++) {
    const entitiesRes = await payload.find({
      collection: 'catalog-entities',
      where: { workspace: { equals: workspaceId } },
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })

    for (const entity of entitiesRes.docs as CatalogEntity[]) {
      await recomputeEntityScore(payload, workspaceId, entity)
      entitiesScored++
    }

    if (!entitiesRes.hasNextPage) break
  }

  // Fire-and-forget score-history snapshot capture (Scorecard Reports &
  // Insights, docs/plans/2026-07-01-scorecard-reports.md WP1) — internally
  // throttled to once per 30 minutes per workspace; a capture failure must
  // never fail this recompute. Dynamic import mirrors the automation-emit
  // hooks (e.g. CatalogEntities, ScorecardRuleResults) — keeps the module
  // boundary loose and the happy path's import graph unchanged.
  if (options.captureSnapshots !== false) {
    ;(async () => {
      try {
        const { captureScoreSnapshots } = await import('./snapshots')
        await captureScoreSnapshots(payload, workspaceId)
      } catch (err) {
        console.error('[recomputeWorkspaceScores] score-snapshot capture failed:', err)
      }
    })()
  }

  return { entitiesScored }
}

/**
 * Build a `scores` lookup (see `EvalContext.scores`) for a set of entity ids
 * from the LATEST stored entity-scores rows — never a live recompute, per the
 * plan's single-pass evaluation-order contract.
 */
async function buildScoreLookup(
  payload: Payload,
  workspaceId: string,
  entityIds: string[],
): Promise<Record<string, EntityScoreLookup>> {
  const ids = [...new Set(entityIds)]
  if (ids.length === 0) return {}

  const res = await payload.find({
    collection: 'entity-scores',
    where: { and: [{ workspace: { equals: workspaceId } }, { entity: { in: ids } }] },
    limit: 2000,
    depth: 0,
    overrideAccess: true,
  })

  const lookup: Record<string, EntityScoreLookup> = {}
  for (const row of res.docs as EntityScore[]) {
    const entityId = relIdOf(row.entity as string | { id: string })
    if (!lookup[entityId]) lookup[entityId] = { overall: null, byScorecard: {} }
    if (row.scope === 'overall') {
      lookup[entityId].overall = row.score
    } else if (row.scope === 'scorecard' && row.scorecard) {
      const scorecardId = relIdOf(row.scorecard as string | { id: string })
      lookup[entityId].byScorecard[scorecardId] = row.score
    }
  }
  return lookup
}

/**
 * Build a `weights` lookup (see `EvalContext.weights`) for a set of entities
 * from their type's `scoringWeight` (resolved once per distinct kind).
 * Entities passed as a bare id (unpopulated relation end) are skipped — the
 * `entity-score` evaluator defaults an unknown id's weight to 1.
 */
async function buildWeightLookup(
  payload: Payload,
  workspaceId: string,
  entities: Array<CatalogEntity | string>,
): Promise<Record<string, number>> {
  const kindByEntityId = new Map<string, EntityKind>()
  for (const e of entities) {
    if (typeof e === 'object' && e && 'kind' in e) kindByEntityId.set(e.id, e.kind as EntityKind)
  }

  const kinds = [...new Set(kindByEntityId.values())]
  const weightByKind = new Map<EntityKind, number>()
  for (const kind of kinds) {
    const def = await resolveEntityType(payload, workspaceId, kind)
    weightByKind.set(kind, def.scoringWeight)
  }

  const weights: Record<string, number> = {}
  for (const [id, kind] of kindByEntityId) {
    weights[id] = weightByKind.get(kind) ?? 1
  }
  return weights
}

/** Remove every current projection owned by one scorecard, then rebuild overall rows. */
export async function clearScorecardProjections(
  payload: Payload,
  scorecardId: string,
  workspaceId: string,
  options: { captureSnapshots?: boolean } = {},
): Promise<void> {
  await payload.delete({
    collection: 'scorecard-rule-results',
    where: { scorecard: { equals: scorecardId } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: 'entity-scores',
    where: { scorecard: { equals: scorecardId } },
    overrideAccess: true,
  })
  await recomputeWorkspaceScores(payload, workspaceId, options)
}

/**
 * Load a scorecard, its rules, and every entity it `appliesTo`; evaluate all
 * rules against each entity and idempotently upsert the results; then fold
 * the fresh results into stored entity-scores. The future Temporal/Go entry
 * point.
 *
 * Evaluation runs in phases, per the plan's documented ordering:
 *   A. Non-score rules (field-presence/relation-check/threshold) evaluate
 *      against each applicable entity and their results are upserted.
 *   B. `recomputeWorkspaceScores` folds those fresh results into stored
 *      entity-scores (workspace-wide — the coverage invariant) so
 *      `entity-score` rules have something current to read.
 *   C. `entity-score` rules evaluate against the LATEST STORED entity-scores
 *      (single pass, no fixpoint — cross-scorecard chains converge on the
 *      next evaluation run) and their results are upserted.
 *   D. `recomputeWorkspaceScores` runs once more so the entity-score rules'
 *      own pass/fail outcomes are folded into this scorecard's score too.
 * Phases C/D are skipped entirely when the scorecard has no `entity-score`
 * rules (B alone already reflects phase A's results).
 */
export async function runScorecardEvaluation(
  payload: Payload,
  scorecardId: string,
  options: { captureSnapshots?: boolean } = {},
): Promise<{
  scorecardId: string
  entitiesEvaluated: number
  rulesEvaluated: number
  resultsWritten: number
}> {
  const scorecard = (await payload.findByID({
    collection: 'scorecards',
    id: scorecardId,
    depth: 0,
    overrideAccess: true,
  })) as Scorecard

  const workspaceId = relIdOf(scorecard.workspace)

  if (scorecard.enabled === false) {
    await clearScorecardProjections(payload, scorecardId, workspaceId, options)
    return { scorecardId, entitiesEvaluated: 0, rulesEvaluated: 0, resultsWritten: 0 }
  }

  // Rules for this scorecard, split: entity-score rules read stored scores
  // (phase C), everything else is evaluated directly off the entity (phase A).
  const rulesRes = await payload.find({
    collection: 'scorecard-rules',
    where: { scorecard: { equals: scorecardId } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const rules = rulesRes.docs as ScorecardRule[]
  const scoreRules = rules.filter((r) => r.type === 'entity-score')
  const otherRules = rules.filter((r) => r.type !== 'entity-score')

  // Build the entity selection: workspace + appliesTo.kind + merged filter.
  const andClauses: Where[] = [{ workspace: { equals: workspaceId } }]
  if (scorecard.appliesTo?.kind) {
    andClauses.push({ kind: { equals: scorecard.appliesTo.kind } })
  }
  const filter = scorecard.appliesTo?.filter
  if (isRecord(filter) && Object.keys(filter).length > 0) {
    andClauses.push(filter as Where)
  }
  const entityWhere: Where = { and: andClauses }

  let entitiesEvaluated = 0
  let rulesEvaluated = 0
  let resultsWritten = 0
  const applicableEntityIds = new Set<string>()

  // --- Phase A: non-score rules ----------------------------------------------

  for (let page = 1; ; page++) {
    const entitiesRes = await payload.find({
      collection: 'catalog-entities',
      where: entityWhere,
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })

    for (const entity of entitiesRes.docs as CatalogEntity[]) {
      applicableEntityIds.add(entity.id)
      // Relations touching this entity (depth 1 so target-kind checks can read
      // the other end's `kind`); skip the query when there's nothing to check.
      const relations =
        otherRules.length > 0
          ? ((
              await payload.find({
                collection: 'catalog-relations',
                where: { or: [{ from: { equals: entity.id } }, { to: { equals: entity.id } }] },
                limit: 1000,
                depth: 1,
                overrideAccess: true,
              })
            ).docs as CatalogRelation[])
          : []
      const ctx: EvalContext = { entity, relations }

      for (const rule of otherRules) {
        const { passed, detail } = evaluateRule(rule, ctx)
        rulesEvaluated++
        await upsertRuleResult(payload, {
          workspaceId,
          scorecardId,
          ruleId: rule.id,
          entityId: entity.id,
          passed,
          detail,
        })
        resultsWritten++
      }

      entitiesEvaluated++
    }

    if (!entitiesRes.hasNextPage) break
  }

  await reconcileScorecardResults(
    payload,
    scorecardId,
    new Set(rules.map((rule) => rule.id)),
    applicableEntityIds,
  )

  // --- Phase B: fold phase A's results into stored entity-scores -------------

  await recomputeWorkspaceScores(payload, workspaceId, options)

  // --- Phases C/D: entity-score rules read the latest stored scores ----------

  if (scoreRules.length > 0) {
    for (let page = 1; ; page++) {
      const entitiesRes = await payload.find({
        collection: 'catalog-entities',
        where: entityWhere,
        limit: PAGE_SIZE,
        page,
        depth: 0,
        overrideAccess: true,
      })

      for (const entity of entitiesRes.docs as CatalogEntity[]) {
        const relsRes = await payload.find({
          collection: 'catalog-relations',
          where: { or: [{ from: { equals: entity.id } }, { to: { equals: entity.id } }] },
          limit: 1000,
          depth: 1,
          overrideAccess: true,
        })
        const relations = relsRes.docs as CatalogRelation[]

        // Broadly gather every related end touching this entity (regardless
        // of type/direction — individual rules filter further) so the score
        // and weight lookups cover whatever any entity-score rule may need.
        const relatedEnds = collectRelatedEnds({ entity, relations }, undefined, 'either')
        const relatedIds = [...new Set(relatedEnds.map((end) => relEndId(end) as string))]

        const [scores, weights] = await Promise.all([
          buildScoreLookup(payload, workspaceId, [entity.id, ...relatedIds]),
          buildWeightLookup(payload, workspaceId, [entity, ...relatedEnds]),
        ])
        const ctx: EvalContext = { entity, relations, scores, weights }

        for (const rule of scoreRules) {
          const { passed, detail } = evaluateRule(rule, ctx)
          rulesEvaluated++
          await upsertRuleResult(payload, {
            workspaceId,
            scorecardId,
            ruleId: rule.id,
            entityId: entity.id,
            passed,
            detail,
          })
          resultsWritten++
        }
      }

      if (!entitiesRes.hasNextPage) break
    }

    await recomputeWorkspaceScores(payload, workspaceId, options)
  }

  // Fire-and-forget score-history snapshot capture — see recomputeWorkspaceScores
  // above (this call is throttle-deduped against any snapshot the phase B/D
  // recomputeWorkspaceScores calls already captured for this run).
  if (options.captureSnapshots !== false) {
    ;(async () => {
      try {
        const { captureScoreSnapshots } = await import('./snapshots')
        await captureScoreSnapshots(payload, workspaceId)
      } catch (err) {
        console.error('[runScorecardEvaluation] score-snapshot capture failed:', err)
      }
    })()
  }

  // Fire-and-forget: reconcile every ACTIVE initiative on this scorecard with
  // the fresh results (auto-complete fixed items, reopen regressions) — the
  // Initiatives auto-sync (docs/plans/2026-07-02-initiatives-ui.md). Mirrors
  // the snapshot capture above: a per-initiative sync failure must NEVER fail
  // an evaluation, and the dynamic import keeps the module boundary loose.
  ;(async () => {
    try {
      const { syncInitiativeActionItems } = await import('./initiatives')
      const initiativesRes = await payload.find({
        collection: 'initiatives',
        where: { and: [{ scorecard: { equals: scorecardId } }, { status: { equals: 'active' } }] },
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      })
      for (const initiative of initiativesRes.docs as { id: string }[]) {
        try {
          await syncInitiativeActionItems(payload, initiative.id)
        } catch (err) {
          console.error(
            `[runScorecardEvaluation] initiative sync failed for ${initiative.id}:`,
            err,
          )
        }
      }
    } catch (err) {
      console.error('[runScorecardEvaluation] initiative sync failed:', err)
    }
  })()

  return { scorecardId, entitiesEvaluated, rulesEvaluated, resultsWritten }
}
