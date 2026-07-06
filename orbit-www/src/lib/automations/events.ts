/**
 * Normalized automation event shapes (IDP refocus P4).
 *
 * Source hooks (scorecard-rule-results, catalog-entities) translate a Payload
 * change into one of these events and hand it to the dispatcher. Events are
 * NESTED (entity/scorecard/rule sub-objects) so both the filter predicate and
 * the input-mapping templates can address fields with the same dotted paths
 * (e.g. `entity.slug`, `rule.title`, `transition`).
 *
 * Pure data — no `server-only`, no Payload import — so the matcher/mapper and
 * their tests stay environment-agnostic.
 */

export type AutomationEventType = 'rule-result-changed' | 'entity-changed' | 'schedule'

/** Pass→fail = drift; fail→pass = recovery; first-ever result = initial. */
export type RuleResultTransition = 'drift' | 'recovery' | 'initial' | 'unchanged'

/** The slice of a catalog entity carried on an event (for filters + templates). */
export interface EventEntityRef {
  id: string
  slug?: string | null
  name?: string | null
  kind?: string | null
  lifecycle?: string | null
}

export interface RuleResultChangedEvent {
  type: 'rule-result-changed'
  workspace: string
  entity: EventEntityRef
  scorecard: { id: string; name?: string | null }
  rule: { id: string; title?: string | null }
  passed: boolean
  /** Prior value, or null when this is the first result for (scorecard, rule, entity). */
  previousPassed: boolean | null
  transition: RuleResultTransition
  detail?: string | null
}

export interface EntityChangedEvent {
  type: 'entity-changed'
  workspace: string
  entity: EventEntityRef
  operation: 'create' | 'update'
}

export interface ScheduleEvent {
  type: 'schedule'
  workspace: string
  automationId: string
}

export type AutomationEvent = RuleResultChangedEvent | EntityChangedEvent | ScheduleEvent
