import { describe, it, expect } from 'vitest'
import { getEventPath, matchesFilter, eventMatchesAutomation } from './match'
import type { RuleResultChangedEvent, EntityChangedEvent } from './events'

const driftEvent: RuleResultChangedEvent = {
  type: 'rule-result-changed',
  workspace: 'ws1',
  entity: { id: 'e1', slug: 'billing', name: 'Billing', kind: 'service', lifecycle: 'production' },
  scorecard: { id: 'sc1', name: 'Prod readiness' },
  rule: { id: 'r1', title: 'Has owner' },
  passed: false,
  previousPassed: true,
  transition: 'drift',
  detail: '`owner` is not set.',
}

const entityEvent: EntityChangedEvent = {
  type: 'entity-changed',
  workspace: 'ws1',
  entity: { id: 'e2', slug: 'api-gw', name: 'API GW', kind: 'api', lifecycle: 'production' },
  operation: 'update',
}

describe('getEventPath', () => {
  it('reads top-level and nested dotted paths', () => {
    expect(getEventPath(driftEvent, 'transition')).toBe('drift')
    expect(getEventPath(driftEvent, 'passed')).toBe(false)
    expect(getEventPath(driftEvent, 'entity.kind')).toBe('service')
    expect(getEventPath(driftEvent, 'rule.title')).toBe('Has owner')
  })
  it('returns undefined for missing paths', () => {
    expect(getEventPath(driftEvent, 'entity.nope')).toBeUndefined()
    expect(getEventPath(driftEvent, 'a.b.c')).toBeUndefined()
  })
})

describe('matchesFilter', () => {
  it('treats an empty / nullish filter as a match-all', () => {
    expect(matchesFilter(undefined, driftEvent)).toBe(true)
    expect(matchesFilter(null, driftEvent)).toBe(true)
    expect(matchesFilter({}, driftEvent)).toBe(true)
  })
  it('matches a scalar by equality', () => {
    expect(matchesFilter({ transition: 'drift' }, driftEvent)).toBe(true)
    expect(matchesFilter({ transition: 'recovery' }, driftEvent)).toBe(false)
  })
  it('matches a boolean scalar', () => {
    expect(matchesFilter({ passed: false }, driftEvent)).toBe(true)
    expect(matchesFilter({ passed: true }, driftEvent)).toBe(false)
  })
  it('matches a nested dotted key', () => {
    expect(matchesFilter({ 'entity.kind': 'service' }, driftEvent)).toBe(true)
    expect(matchesFilter({ 'entity.kind': 'api' }, driftEvent)).toBe(false)
  })
  it('matches an array filter as membership (in)', () => {
    expect(matchesFilter({ 'entity.kind': ['service', 'api'] }, driftEvent)).toBe(true)
    expect(matchesFilter({ 'entity.kind': ['api', 'datastore'] }, driftEvent)).toBe(false)
  })
  it('ANDs all keys', () => {
    expect(matchesFilter({ transition: 'drift', 'entity.kind': 'service' }, driftEvent)).toBe(true)
    expect(matchesFilter({ transition: 'drift', 'entity.kind': 'api' }, driftEvent)).toBe(false)
  })
})

describe('eventMatchesAutomation', () => {
  const base = { id: 'a1', enabled: true, action: 'act1' }

  it('requires the event type to equal the automation trigger event', () => {
    expect(
      eventMatchesAutomation(driftEvent, { ...base, trigger: { event: 'rule-result-changed' } }),
    ).toBe(true)
    expect(
      eventMatchesAutomation(driftEvent, { ...base, trigger: { event: 'entity-changed' } }),
    ).toBe(false)
  })

  it('skips disabled automations', () => {
    expect(
      eventMatchesAutomation(driftEvent, {
        ...base,
        enabled: false,
        trigger: { event: 'rule-result-changed' },
      }),
    ).toBe(false)
  })

  it('applies the trigger filter', () => {
    expect(
      eventMatchesAutomation(driftEvent, {
        ...base,
        trigger: { event: 'rule-result-changed', filter: { transition: 'drift' } },
      }),
    ).toBe(true)
    expect(
      eventMatchesAutomation(driftEvent, {
        ...base,
        trigger: { event: 'rule-result-changed', filter: { transition: 'recovery' } },
      }),
    ).toBe(false)
  })

  it('matches entity-changed with a kind filter', () => {
    expect(
      eventMatchesAutomation(entityEvent, {
        ...base,
        trigger: { event: 'entity-changed', filter: { 'entity.kind': 'api' } },
      }),
    ).toBe(true)
  })
})
