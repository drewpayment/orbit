import type { Payload, Where } from 'payload'
import type { CatalogEntity, CatalogRelation, Scorecard, ScorecardRule } from '@/payload-types'

/**
 * Scorecard rule-evaluation engine (IDP refocus P2).
 *
 * Rules are DATA, not code: each scorecard-rule carries a JSON `expression`
 * interpreted here per `type`. The three shapes (documented on the
 * ScorecardRules collection) are:
 *
 *   - field-presence: { path, op: 'exists' | 'not-empty' }
 *   - relation-check: { relationType, direction?: 'from'|'to'|'either',
 *                       targetKind?, min?(default 1) }
 *   - threshold:      { path, op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in', value }
 *
 * `path` is a dotted accessor into the entity (e.g. 'owner',
 * 'metadata.costCenter'). The pure functions here are fully unit-tested; the
 * orchestrator (`runScorecardEvaluation`) is the future Temporal/Go entry point
 * and idempotently writes scorecard-rule-results.
 */

export type EvalContext = { entity: CatalogEntity; relations: CatalogRelation[] }

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
      return { passed, detail: `\`${path}\` (${show(actual)}) ${passed ? '==' : '!='} ${show(expected)}.` }
    }
    case 'neq': {
      const passed = !valuesEqual(actual, expected)
      return { passed, detail: `\`${path}\` (${show(actual)}) ${passed ? '!=' : '=='} ${show(expected)}.` }
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const na = Number(actual)
      const nb = Number(expected)
      if (Number.isNaN(na) || Number.isNaN(nb)) {
        return fail(`threshold: \`${path}\` (${show(actual)}) or value (${show(expected)}) is not numeric for op "${op}".`)
      }
      const passed =
        op === 'gt' ? na > nb : op === 'gte' ? na >= nb : op === 'lt' ? na < nb : na <= nb
      return { passed, detail: `\`${path}\` (${na}) ${passed ? 'satisfies' : 'fails'} ${op} ${nb}.` }
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

function evalRelationCheck(expr: RelationCheckExpr, ctx: EvalContext): RuleEvalResult {
  const { relationType, targetKind } = expr
  const direction: RelationDirection = expr.direction ?? 'either'
  const min = typeof expr.min === 'number' ? expr.min : 1

  if (typeof relationType !== 'string' || !relationType) {
    return fail('relation-check: missing `relationType`.')
  }

  const entityId = ctx.entity.id
  let count = 0
  for (const rel of ctx.relations) {
    if (rel.type !== relationType) continue

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

    // Optional target-kind filter requires the other end to be populated so we
    // can read its `kind`; an unpopulated id cannot match and is not counted.
    if (targetKind) {
      if (typeof otherEnd !== 'object' || otherEnd == null) continue
      if (otherEnd.kind !== targetKind) continue
    }

    count++
  }

  const passed = count >= min
  const kindNote = targetKind ? ` to ${targetKind}` : ''
  return {
    passed,
    detail: `Found ${count} \`${relationType}\` relation(s)${kindNote} (${direction}); need ≥ ${min}.`,
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

  const created = await payload.create({
    collection: 'scorecard-rule-results',
    data,
    overrideAccess: true,
  })
  return created.id
}

function relIdOf(v: string | { id: string }): string {
  return typeof v === 'string' ? v : v.id
}

/**
 * Load a scorecard, its rules, and every entity it `appliesTo`, evaluate all
 * rules against each entity, and idempotently upsert the results. The future
 * Temporal/Go entry point.
 */
export async function runScorecardEvaluation(
  payload: Payload,
  scorecardId: string,
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

  // Rules for this scorecard.
  const rulesRes = await payload.find({
    collection: 'scorecard-rules',
    where: { scorecard: { equals: scorecardId } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const rules = rulesRes.docs as ScorecardRule[]

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
      // Relations touching this entity (depth 1 so target-kind checks can read
      // the other end's `kind`).
      const relsRes = await payload.find({
        collection: 'catalog-relations',
        where: {
          or: [{ from: { equals: entity.id } }, { to: { equals: entity.id } }],
        },
        limit: 1000,
        depth: 1,
        overrideAccess: true,
      })
      const ctx: EvalContext = { entity, relations: relsRes.docs as CatalogRelation[] }

      for (const rule of rules) {
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

  return { scorecardId, entitiesEvaluated, rulesEvaluated, resultsWritten }
}
