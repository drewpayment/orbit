import type { AutomationEvent } from './events'

/**
 * Automation event matching (IDP refocus P4) — pure, fully unit-tested.
 *
 * Two responsibilities:
 *   - {@link matchesFilter}: evaluate an automation's `trigger.filter` (a small
 *     JSON predicate) against a normalized event, in-process. Kept deliberately
 *     simple — a flat object of `dotted.path → expected`, AND-ed together, where
 *     a scalar means equality and an array means membership (`in`). We do NOT
 *     round-trip to Mongo: this runs on the hot afterChange path.
 *   - {@link eventMatchesAutomation}: the full gate — enabled, event-type match,
 *     then the filter.
 */

/** Read a dotted path (e.g. 'entity.kind') off an event, or undefined. */
export function getEventPath(event: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, event)
}

function scalarEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isNaN(na) || Number.isNaN(nb)) return false
    return na === nb
  }
  return a === b
}

/**
 * True if every entry in `filter` is satisfied by the event. A nullish/empty
 * filter is a match-all. Array expected values match by membership; scalars by
 * (loose-numeric) equality.
 */
export function matchesFilter(filter: unknown, event: AutomationEvent): boolean {
  if (filter == null) return true
  if (typeof filter !== 'object' || Array.isArray(filter)) return false
  const entries = Object.entries(filter as Record<string, unknown>)
  if (entries.length === 0) return true

  return entries.every(([path, expected]) => {
    const actual = getEventPath(event, path)
    if (Array.isArray(expected)) {
      return expected.some((e) => scalarEquals(actual, e))
    }
    return scalarEquals(actual, expected)
  })
}

/** The minimal shape of an automation the matcher needs (subset of the doc). */
export interface MatchableAutomation {
  id: string
  enabled?: boolean | null
  trigger?: { event?: string | null; filter?: unknown } | null
}

/**
 * Full gate: the automation is enabled, its trigger event equals the event
 * type, and its filter matches.
 */
export function eventMatchesAutomation(
  event: AutomationEvent,
  automation: MatchableAutomation,
): boolean {
  if (automation.enabled === false) return false
  if (automation.trigger?.event !== event.type) return false
  return matchesFilter(automation.trigger?.filter, event)
}
