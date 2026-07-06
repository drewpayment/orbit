import 'server-only'
import type { Payload } from 'payload'
import type {
  CatalogEntity,
  ScorecardRuleResult,
  ScorecardRule,
  Scorecard,
} from '@/payload-types'
import { dispatchAutomationEvent } from './dispatch'
import type {
  EntityChangedEvent,
  EventEntityRef,
  RuleResultChangedEvent,
  RuleResultTransition,
} from './events'

/**
 * Event emission helpers (IDP refocus P4) — translate a Payload change on a
 * source collection into a normalized AutomationEvent and hand it to the
 * dispatcher. Called fire-and-forget from afterChange hooks: they catch their
 * own errors and must NEVER block or fail the originating save.
 *
 * Note these run with a fresh Payload local-API context (`overrideAccess`), so
 * they re-fetch the related rows they need to enrich the event for filters and
 * input-mapping templates.
 */

function relId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }
  return null
}

/** Build the entity ref carried on events (best-effort enrichment). */
async function loadEntityRef(payload: Payload, entityId: string): Promise<EventEntityRef> {
  try {
    const e = (await payload.findByID({
      collection: 'catalog-entities',
      id: entityId,
      depth: 0,
      overrideAccess: true,
    })) as CatalogEntity
    return { id: e.id, slug: e.slug, name: e.name, kind: e.kind, lifecycle: e.lifecycle }
  } catch {
    return { id: entityId }
  }
}

/** Pass→fail = drift; fail→pass = recovery; create = initial; else unchanged. */
function classify(
  operation: 'create' | 'update',
  previousPassed: boolean | null,
  passed: boolean,
): RuleResultTransition {
  if (operation === 'create' || previousPassed === null) return 'initial'
  if (previousPassed === passed) return 'unchanged'
  return previousPassed && !passed ? 'drift' : 'recovery'
}

/**
 * Emit a `rule-result-changed` event for a scorecard-rule-result change. Skips
 * `unchanged` transitions (the common case on a re-evaluation sweep) so we only
 * dispatch on a real pass/fail transition or a first-ever result.
 */
export async function emitRuleResultChanged(
  payload: Payload,
  args: {
    doc: ScorecardRuleResult
    previousDoc?: ScorecardRuleResult | null
    operation: 'create' | 'update'
  },
): Promise<void> {
  const { doc, previousDoc, operation } = args
  const workspace = relId(doc.workspace)
  const entityId = relId(doc.entity)
  const scorecardId = relId(doc.scorecard)
  const ruleId = relId(doc.rule)
  if (!workspace || !entityId || !scorecardId || !ruleId) return

  const passed = !!doc.passed
  const previousPassed =
    operation === 'create' || !previousDoc ? null : !!previousDoc.passed
  const transition = classify(operation, previousPassed, passed)
  if (transition === 'unchanged') return

  const entity = await loadEntityRef(payload, entityId)

  let ruleTitle: string | null = null
  try {
    const rule = (await payload.findByID({
      collection: 'scorecard-rules',
      id: ruleId,
      depth: 0,
      overrideAccess: true,
    })) as ScorecardRule
    ruleTitle = rule.title ?? null
  } catch {
    /* name is optional */
  }

  let scorecardName: string | null = null
  try {
    const sc = (await payload.findByID({
      collection: 'scorecards',
      id: scorecardId,
      depth: 0,
      overrideAccess: true,
    })) as Scorecard
    scorecardName = sc.name ?? null
  } catch {
    /* name is optional */
  }

  const event: RuleResultChangedEvent = {
    type: 'rule-result-changed',
    workspace,
    entity,
    scorecard: { id: scorecardId, name: scorecardName },
    rule: { id: ruleId, title: ruleTitle },
    passed,
    previousPassed,
    transition,
    detail: doc.detail ?? null,
  }

  await dispatchAutomationEvent(payload, event)
}

/** Emit an `entity-changed` event for a catalog-entities change. */
export async function emitEntityChanged(
  payload: Payload,
  args: { doc: CatalogEntity; operation: 'create' | 'update' },
): Promise<void> {
  const { doc, operation } = args
  const workspace = relId(doc.workspace)
  if (!workspace) return

  const event: EntityChangedEvent = {
    type: 'entity-changed',
    workspace,
    entity: { id: doc.id, slug: doc.slug, name: doc.name, kind: doc.kind, lifecycle: doc.lifecycle },
    operation,
  }

  await dispatchAutomationEvent(payload, event)
}
