import { describe, it, expect } from 'vitest'
import type { CatalogEntity, CatalogRelation, ScorecardRule } from '@/payload-types'
import { evaluateRule, computeEntityLevel, type EvalContext } from './evaluate'

// --- fixtures ---------------------------------------------------------------

/** Build a minimal CatalogEntity; only the fields rules read need to be real. */
function entity(partial: Partial<CatalogEntity> = {}): CatalogEntity {
  return {
    id: partial.id ?? 'e1',
    name: partial.name ?? 'svc-a',
    kind: partial.kind ?? 'service',
    workspace: partial.workspace ?? 'ws1',
    source: partial.source ?? { type: 'manual' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as CatalogEntity
}

/** Build a CatalogRelation. `from`/`to` may be ids or populated entities. */
function relation(partial: Partial<CatalogRelation>): CatalogRelation {
  return {
    id: partial.id ?? 'r1',
    workspace: partial.workspace ?? 'ws1',
    from: partial.from ?? 'e1',
    to: partial.to ?? 'e2',
    type: partial.type ?? 'depends-on',
    source: partial.source ?? { type: 'manual' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as CatalogRelation
}

/** Build a ScorecardRule from a type + expression. */
function rule(
  type: ScorecardRule['type'],
  expression: unknown,
  extra: Partial<ScorecardRule> = {},
): ScorecardRule {
  return {
    id: 'rule1',
    scorecard: 'sc1',
    workspace: 'ws1',
    title: 'test rule',
    type,
    expression: expression as ScorecardRule['expression'],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as ScorecardRule
}

const ctx = (e: CatalogEntity, relations: CatalogRelation[] = []): EvalContext => ({
  entity: e,
  relations,
})

// --- evaluateRule: field-presence -------------------------------------------

describe('evaluateRule — field-presence', () => {
  const cases: Array<{
    name: string
    rule: ScorecardRule
    entity: CatalogEntity
    expected: boolean
  }> = [
    {
      name: 'exists: top-level owner present (id) → pass',
      rule: rule('field-presence', { path: 'owner', op: 'exists' }),
      entity: entity({ owner: 'team-1' }),
      expected: true,
    },
    {
      name: 'exists: owner missing → fail',
      rule: rule('field-presence', { path: 'owner', op: 'exists' }),
      entity: entity({ owner: null }),
      expected: false,
    },
    {
      name: 'exists: dotted metadata path present → pass',
      rule: rule('field-presence', { path: 'metadata.costCenter', op: 'exists' }),
      entity: entity({ metadata: { costCenter: 'CC-100' } }),
      expected: true,
    },
    {
      name: 'exists: dotted metadata path missing → fail',
      rule: rule('field-presence', { path: 'metadata.costCenter', op: 'exists' }),
      entity: entity({ metadata: { team: 'x' } }),
      expected: false,
    },
    {
      name: 'not-empty: empty string → fail',
      rule: rule('field-presence', { path: 'description', op: 'not-empty' }),
      entity: entity({ description: '   ' }),
      expected: false,
    },
    {
      name: 'not-empty: non-empty string → pass',
      rule: rule('field-presence', { path: 'description', op: 'not-empty' }),
      entity: entity({ description: 'hello' }),
      expected: true,
    },
    {
      name: 'not-empty: empty array → fail',
      rule: rule('field-presence', { path: 'metadata.tags', op: 'not-empty' }),
      entity: entity({ metadata: { tags: [] } }),
      expected: false,
    },
    {
      name: 'not-empty: present but null → fail',
      rule: rule('field-presence', { path: 'owner', op: 'not-empty' }),
      entity: entity({ owner: null }),
      expected: false,
    },
    {
      name: 'exists: value of 0 still exists → pass',
      rule: rule('field-presence', { path: 'metadata.replicas', op: 'exists' }),
      entity: entity({ metadata: { replicas: 0 } }),
      expected: true,
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const res = evaluateRule(c.rule, ctx(c.entity))
      expect(res.passed).toBe(c.expected)
      expect(typeof res.detail).toBe('string')
      expect(res.detail.length).toBeGreaterThan(0)
    })
  }
})

// --- evaluateRule: threshold ------------------------------------------------

describe('evaluateRule — threshold', () => {
  const cases: Array<{
    name: string
    rule: ScorecardRule
    entity: CatalogEntity
    expected: boolean
  }> = [
    {
      name: 'eq string match → pass',
      rule: rule('threshold', { path: 'health', op: 'eq', value: 'healthy' }),
      entity: entity({ health: 'healthy' }),
      expected: true,
    },
    {
      name: 'eq string mismatch → fail',
      rule: rule('threshold', { path: 'health', op: 'eq', value: 'healthy' }),
      entity: entity({ health: 'degraded' }),
      expected: false,
    },
    {
      name: 'neq → pass when different',
      rule: rule('threshold', { path: 'lifecycle', op: 'neq', value: 'deprecated' }),
      entity: entity({ lifecycle: 'production' }),
      expected: true,
    },
    {
      name: 'gt numeric → pass',
      rule: rule('threshold', { path: 'metadata.replicas', op: 'gt', value: 2 }),
      entity: entity({ metadata: { replicas: 3 } }),
      expected: true,
    },
    {
      name: 'gt numeric → fail (equal)',
      rule: rule('threshold', { path: 'metadata.replicas', op: 'gt', value: 3 }),
      entity: entity({ metadata: { replicas: 3 } }),
      expected: false,
    },
    {
      name: 'gte numeric → pass (equal)',
      rule: rule('threshold', { path: 'metadata.replicas', op: 'gte', value: 3 }),
      entity: entity({ metadata: { replicas: 3 } }),
      expected: true,
    },
    {
      name: 'lt numeric → pass',
      rule: rule('threshold', { path: 'metadata.errorRate', op: 'lt', value: 0.05 }),
      entity: entity({ metadata: { errorRate: 0.01 } }),
      expected: true,
    },
    {
      name: 'lte numeric → fail',
      rule: rule('threshold', { path: 'metadata.errorRate', op: 'lte', value: 0.05 }),
      entity: entity({ metadata: { errorRate: 0.06 } }),
      expected: false,
    },
    {
      name: 'gt with non-numeric actual → fail',
      rule: rule('threshold', { path: 'metadata.replicas', op: 'gt', value: 2 }),
      entity: entity({ metadata: { replicas: 'lots' } }),
      expected: false,
    },
    {
      name: 'in: actual in list → pass',
      rule: rule('threshold', { path: 'tier', op: 'in', value: ['tier-1', 'tier-2'] }),
      entity: entity({ tier: 'tier-1' }),
      expected: true,
    },
    {
      name: 'in: actual not in list → fail',
      rule: rule('threshold', { path: 'tier', op: 'in', value: ['tier-1', 'tier-2'] }),
      entity: entity({ tier: 'tier-3' }),
      expected: false,
    },
    {
      name: 'in: actual array intersects list → pass',
      rule: rule('threshold', { path: 'metadata.tags', op: 'in', value: ['pii', 'gdpr'] }),
      entity: entity({ metadata: { tags: ['internal', 'pii'] } }),
      expected: true,
    },
    {
      name: 'in: actual array disjoint from list → fail',
      rule: rule('threshold', { path: 'metadata.tags', op: 'in', value: ['pii'] }),
      entity: entity({ metadata: { tags: ['internal'] } }),
      expected: false,
    },
    {
      name: 'eq: missing path (undefined) → fail',
      rule: rule('threshold', { path: 'metadata.replicas', op: 'eq', value: 3 }),
      entity: entity({ metadata: {} }),
      expected: false,
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const res = evaluateRule(c.rule, ctx(c.entity))
      expect(res.passed).toBe(c.expected)
      expect(res.detail.length).toBeGreaterThan(0)
    })
  }
})

// --- evaluateRule: relation-check -------------------------------------------

describe('evaluateRule — relation-check', () => {
  const e1 = entity({ id: 'e1', kind: 'service' })

  it('counts outgoing (from) relations of type → pass at min 1', () => {
    const rels = [relation({ from: 'e1', to: 'topic-1', type: 'produces-topic' })]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'produces-topic', direction: 'from' }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(true)
  })

  it('direction from: relation where entity is the target does not count → fail', () => {
    const rels = [relation({ from: 'other', to: 'e1', type: 'produces-topic' })]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'produces-topic', direction: 'from' }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(false)
  })

  it('direction to: counts incoming relations → pass', () => {
    const rels = [relation({ from: 'other', to: 'e1', type: 'depends-on' })]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'depends-on', direction: 'to' }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(true)
  })

  it('direction either (default): counts both directions', () => {
    const rels = [relation({ from: 'other', to: 'e1', type: 'depends-on' })]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'depends-on' }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(true)
  })

  it('wrong relation type → fail', () => {
    const rels = [relation({ from: 'e1', to: 'x', type: 'owns' })]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'depends-on' }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(false)
  })

  it('min threshold: requires 2, only 1 present → fail', () => {
    const rels = [relation({ from: 'e1', to: 'x', type: 'depends-on' })]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'depends-on', direction: 'from', min: 2 }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(false)
  })

  it('min threshold: requires 2, two present → pass', () => {
    const rels = [
      relation({ id: 'r1', from: 'e1', to: 'x', type: 'depends-on' }),
      relation({ id: 'r2', from: 'e1', to: 'y', type: 'depends-on' }),
    ]
    const res = evaluateRule(
      rule('relation-check', { relationType: 'depends-on', direction: 'from', min: 2 }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(true)
  })

  it('targetKind: matches populated other-end kind → pass', () => {
    const topic = entity({ id: 'topic-1', kind: 'kafka-topic' })
    const rels = [relation({ from: 'e1', to: topic, type: 'produces-topic' })]
    const res = evaluateRule(
      rule('relation-check', {
        relationType: 'produces-topic',
        direction: 'from',
        targetKind: 'kafka-topic',
      }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(true)
  })

  it('targetKind: other-end kind mismatch → fail', () => {
    const other = entity({ id: 'svc-2', kind: 'service' })
    const rels = [relation({ from: 'e1', to: other, type: 'produces-topic' })]
    const res = evaluateRule(
      rule('relation-check', {
        relationType: 'produces-topic',
        direction: 'from',
        targetKind: 'kafka-topic',
      }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(false)
  })

  it('targetKind set but other-end is an unpopulated id → does not count → fail', () => {
    const rels = [relation({ from: 'e1', to: 'topic-1', type: 'produces-topic' })]
    const res = evaluateRule(
      rule('relation-check', {
        relationType: 'produces-topic',
        direction: 'from',
        targetKind: 'kafka-topic',
      }),
      ctx(e1, rels),
    )
    expect(res.passed).toBe(false)
  })

  it('no relations at all → fail', () => {
    const res = evaluateRule(
      rule('relation-check', { relationType: 'depends-on' }),
      ctx(e1, []),
    )
    expect(res.passed).toBe(false)
  })
})

// --- evaluateRule: malformed expressions ------------------------------------

describe('evaluateRule — malformed expression', () => {
  it('returns a failing result with detail when expression is null', () => {
    const res = evaluateRule(rule('field-presence', null), ctx(entity()))
    expect(res.passed).toBe(false)
    expect(res.detail.length).toBeGreaterThan(0)
  })

  it('returns failing result for unknown op', () => {
    const res = evaluateRule(
      rule('threshold', { path: 'health', op: 'weird', value: 'x' }),
      ctx(entity({ health: 'healthy' })),
    )
    expect(res.passed).toBe(false)
  })
})

// --- computeEntityLevel -----------------------------------------------------

describe('computeEntityLevel', () => {
  const levels = [
    { name: 'Bronze', rank: 1 },
    { name: 'Silver', rank: 2 },
    { name: 'Gold', rank: 3 },
  ]

  it('no levels defined → null / rank 0', () => {
    const res = computeEntityLevel([], [{ level: 'Bronze', passed: true }])
    expect(res).toEqual({ levelName: null, rank: 0 })
  })

  it('base (no-level) rule fails → no level achieved', () => {
    const res = computeEntityLevel(levels, [
      { level: null, passed: false },
      { level: 'Bronze', passed: true },
    ])
    expect(res).toEqual({ levelName: null, rank: 0 })
  })

  it('only Bronze rules pass → Bronze', () => {
    const res = computeEntityLevel(levels, [
      { level: 'Bronze', passed: true },
      { level: 'Silver', passed: false },
      { level: 'Gold', passed: false },
    ])
    expect(res).toEqual({ levelName: 'Bronze', rank: 1 })
  })

  it('Bronze + Silver pass, Gold fails → Silver', () => {
    const res = computeEntityLevel(levels, [
      { level: 'Bronze', passed: true },
      { level: 'Silver', passed: true },
      { level: 'Gold', passed: false },
    ])
    expect(res).toEqual({ levelName: 'Silver', rank: 2 })
  })

  it('all rules pass → Gold', () => {
    const res = computeEntityLevel(levels, [
      { level: null, passed: true },
      { level: 'Bronze', passed: true },
      { level: 'Silver', passed: true },
      { level: 'Gold', passed: true },
    ])
    expect(res).toEqual({ levelName: 'Gold', rank: 3 })
  })

  it('ladder is monotonic: Bronze fails blocks Silver even if Silver rules pass', () => {
    const res = computeEntityLevel(levels, [
      { level: 'Bronze', passed: false },
      { level: 'Silver', passed: true },
    ])
    expect(res).toEqual({ levelName: null, rank: 0 })
  })

  it('multiple rules per level: one fails → level not achieved', () => {
    const res = computeEntityLevel(levels, [
      { level: 'Bronze', passed: true },
      { level: 'Bronze', passed: false },
    ])
    expect(res).toEqual({ levelName: null, rank: 0 })
  })

  it('level with no rules is achieved if lower levels pass', () => {
    const res = computeEntityLevel(levels, [
      { level: 'Bronze', passed: true },
      // no Silver/Gold rules tagged
    ])
    expect(res).toEqual({ levelName: 'Gold', rank: 3 })
  })
})
