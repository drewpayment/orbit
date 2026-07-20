import { describe, it, expect } from 'vitest'
import type { Payload } from 'payload'
import type { CatalogEntity, CatalogRelation, ScorecardRule } from '@/payload-types'
import {
  evaluateRule,
  computeEntityLevel,
  runScorecardEvaluation,
  recomputeWorkspaceScores,
  type EvalContext,
} from './evaluate'

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

const ctx = (
  e: CatalogEntity,
  relations: CatalogRelation[] = [],
  extra: Partial<Pick<EvalContext, 'scores' | 'weights'>> = {},
): EvalContext => ({
  entity: e,
  relations,
  ...extra,
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
    const res = evaluateRule(rule('relation-check', { relationType: 'depends-on' }), ctx(e1, rels))
    expect(res.passed).toBe(true)
  })

  it('wrong relation type → fail', () => {
    const rels = [relation({ from: 'e1', to: 'x', type: 'owns' })]
    const res = evaluateRule(rule('relation-check', { relationType: 'depends-on' }), ctx(e1, rels))
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
    const res = evaluateRule(rule('relation-check', { relationType: 'depends-on' }), ctx(e1, []))
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

// --- evaluateRule: entity-score ----------------------------------------------

describe('evaluateRule — entity-score', () => {
  const e1 = entity({ id: 'e1', kind: 'service' })

  // --- target: self ----------------------------------------------------------

  describe('target: self', () => {
    it("overall scope (default): compares the entity's own overall score", () => {
      const scores = { e1: { overall: 80, byScorecard: {} } }
      const res = evaluateRule(
        rule('entity-score', { target: 'self', op: 'gte', value: 70 }),
        ctx(e1, [], { scores }),
      )
      expect(res.passed).toBe(true)
      expect(res.detail).toContain('80')
    })

    it('overall scope: fails when below the threshold', () => {
      const scores = { e1: { overall: 60, byScorecard: {} } }
      const res = evaluateRule(
        rule('entity-score', { target: 'self', op: 'gte', value: 70 }),
        ctx(e1, [], { scores }),
      )
      expect(res.passed).toBe(false)
    })

    it("scorecard scope: reads the named scorecard's stored score", () => {
      const scores = { e1: { overall: 80, byScorecard: { sc1: 55 } } }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'self',
          scoreScope: 'scorecard',
          scorecardId: 'sc1',
          op: 'eq',
          value: 55,
        }),
        ctx(e1, [], { scores }),
      )
      expect(res.passed).toBe(true)
    })

    it('scorecard scope without `scorecardId` -> fail with clear detail', () => {
      const res = evaluateRule(
        rule('entity-score', { target: 'self', scoreScope: 'scorecard', op: 'gte', value: 50 }),
        ctx(e1, [], { scores: { e1: { overall: 80, byScorecard: {} } } }),
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toContain('scorecardId')
    })

    it('no `ctx.scores` at all -> fail with clear "no stored score" detail', () => {
      const res = evaluateRule(
        rule('entity-score', { target: 'self', op: 'gte', value: 50 }),
        ctx(e1),
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toMatch(/no stored .* score/i)
    })

    it('ctx.scores present for other entities but not this one -> fail', () => {
      const scores = { other: { overall: 100, byScorecard: {} } }
      const res = evaluateRule(
        rule('entity-score', { target: 'self', op: 'gte', value: 50 }),
        ctx(e1, [], { scores }),
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toMatch(/no stored .* score/i)
    })

    it('scorecard scope: this entity has an overall score but not the requested scorecard -> fail', () => {
      const scores = { e1: { overall: 80, byScorecard: { other: 90 } } }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'self',
          scoreScope: 'scorecard',
          scorecardId: 'sc1',
          op: 'gte',
          value: 50,
        }),
        ctx(e1, [], { scores }),
      )
      expect(res.passed).toBe(false)
    })
  })

  // --- target: related, per aggregate -----------------------------------------

  describe('target: related', () => {
    const rels = [
      relation({ id: 'r1', from: 'e1', to: 'a', type: 'depends-on' }),
      relation({ id: 'r2', from: 'e1', to: 'b', type: 'depends-on' }),
      relation({ id: 'r3', from: 'e1', to: 'c', type: 'depends-on' }),
    ]

    it('aggregate "min" (default): the weakest related score decides pass/fail', () => {
      const scores = {
        a: { overall: 90, byScorecard: {} },
        b: { overall: 40, byScorecard: {} },
        c: { overall: 100, byScorecard: {} },
      }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          op: 'gte',
          value: 70,
        }),
        ctx(e1, rels, { scores }),
      )
      expect(res.passed).toBe(false) // min is 40
      expect(res.detail).toContain('40')
    })

    it('aggregate "max": the strongest related score decides pass/fail', () => {
      const scores = {
        a: { overall: 90, byScorecard: {} },
        b: { overall: 40, byScorecard: {} },
        c: { overall: 100, byScorecard: {} },
      }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'max',
          op: 'gte',
          value: 70,
        }),
        ctx(e1, rels, { scores }),
      )
      expect(res.passed).toBe(true) // max is 100
    })

    it('aggregate "avg": equal weights -> plain mean', () => {
      const scores = {
        a: { overall: 100, byScorecard: {} },
        b: { overall: 0, byScorecard: {} },
        c: { overall: 50, byScorecard: {} },
      }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'avg',
          op: 'eq',
          value: 50,
        }),
        ctx(e1, rels, { scores }),
      )
      expect(res.passed).toBe(true) // (100+0+50)/3 = 50
    })

    it('aggregate "avg": weighted by each related entity\'s type scoringWeight', () => {
      // a=100 weight 3, b=0 weight 1, c not related here -> weighted mean = (300+0)/4 = 75
      const rels2 = [
        relation({ id: 'r1', from: 'e1', to: 'a', type: 'depends-on' }),
        relation({ id: 'r2', from: 'e1', to: 'b', type: 'depends-on' }),
      ]
      const scores = { a: { overall: 100, byScorecard: {} }, b: { overall: 0, byScorecard: {} } }
      const weights = { a: 3, b: 1 }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'avg',
          op: 'eq',
          value: 75,
        }),
        ctx(e1, rels2, { scores, weights }),
      )
      expect(res.passed).toBe(true)
    })

    it('related entity with no `ctx.weights` entry defaults to weight 1', () => {
      const rels2 = [
        relation({ id: 'r1', from: 'e1', to: 'a', type: 'depends-on' }),
        relation({ id: 'r2', from: 'e1', to: 'b', type: 'depends-on' }),
      ]
      const scores = { a: { overall: 100, byScorecard: {} }, b: { overall: 0, byScorecard: {} } }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'avg',
          op: 'eq',
          value: 50,
        }),
        ctx(e1, rels2, { scores }), // no weights -> both default to 1 -> plain mean
      )
      expect(res.passed).toBe(true)
    })

    it('targetKind filters which related entities are compiled', () => {
      const topic = entity({ id: 'topic-1', kind: 'kafka-topic' })
      const svc = entity({ id: 'svc-2', kind: 'service' })
      const relsMixed = [
        relation({ id: 'r1', from: 'e1', to: topic, type: 'produces-topic' }),
        relation({ id: 'r2', from: 'e1', to: svc, type: 'produces-topic' }),
      ]
      const scores = {
        'topic-1': { overall: 10, byScorecard: {} },
        'svc-2': { overall: 90, byScorecard: {} },
      }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'produces-topic',
          direction: 'from',
          targetKind: 'kafka-topic',
          aggregate: 'min',
          op: 'gte',
          value: 5,
        }),
        ctx(e1, relsMixed, { scores }),
      )
      // Only topic-1 (score 10) is compiled — svc-2 is filtered out by targetKind.
      expect(res.passed).toBe(true)
      expect(res.detail).toContain('10')
    })

    it('missing `relationType` -> fail with clear detail', () => {
      const res = evaluateRule(
        rule('entity-score', { target: 'related', op: 'gte', value: 50 }),
        ctx(e1, rels, { scores: {} }),
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toContain('relationType')
    })

    it('no matching relations at all -> fail with clear detail', () => {
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'owns',
          direction: 'from',
          op: 'gte',
          value: 50,
        }),
        ctx(e1, rels, { scores: {} }),
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toMatch(/no related entities/i)
    })

    it('relations exist but none of the related entities have a stored score -> fail with clear detail', () => {
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          op: 'gte',
          value: 50,
        }),
        ctx(e1, rels, { scores: {} }), // no scores recorded for a/b/c
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toMatch(/have a stored .* score/i)
    })

    it('some related entities missing scores: aggregates over the ones found, notes the rest as excluded', () => {
      const scores = { a: { overall: 90, byScorecard: {} } } // b, c have no stored score
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          op: 'gte',
          value: 80,
        }),
        ctx(e1, rels, { scores }),
      )
      expect(res.passed).toBe(true) // only 'a' (90) counted -> min is 90
      expect(res.detail).toMatch(/missing/i)
    })

    it('related entities deduplicated: two relations to the same target count it once', () => {
      const dupeRels = [
        relation({ id: 'r1', from: 'e1', to: 'a', type: 'depends-on' }),
        relation({ id: 'r2', from: 'e1', to: 'a', type: 'depends-on' }),
      ]
      const scores = { a: { overall: 50, byScorecard: {} } }
      const res = evaluateRule(
        rule('entity-score', {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'avg',
          op: 'eq',
          value: 50,
        }),
        ctx(e1, dupeRels, { scores }),
      )
      expect(res.passed).toBe(true) // avg of a single 50, not double-counted
      expect(res.detail).toContain('1 related')
    })
  })

  // --- malformed / edge cases --------------------------------------------------

  describe('malformed expressions', () => {
    it('unknown target -> fail with clear detail', () => {
      const res = evaluateRule(
        rule('entity-score', { target: 'nowhere', op: 'gte', value: 50 }),
        ctx(e1, [], { scores: {} }),
      )
      expect(res.passed).toBe(false)
      expect(res.detail).toContain('target')
    })

    it('unknown op -> fail', () => {
      const res = evaluateRule(
        rule('entity-score', { target: 'self', op: 'weird', value: 50 }),
        ctx(e1, [], { scores: { e1: { overall: 80, byScorecard: {} } } }),
      )
      expect(res.passed).toBe(false)
    })

    it('non-numeric `value` -> fail', () => {
      const res = evaluateRule(
        rule('entity-score', { target: 'self', op: 'gte', value: 'high' }),
        ctx(e1, [], { scores: { e1: { overall: 80, byScorecard: {} } } }),
      )
      expect(res.passed).toBe(false)
    })
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

// --- orchestration: recomputeWorkspaceScores / runScorecardEvaluation -------
//
// These exercise the full recompute pipeline against a hand-rolled in-memory
// fake of the Payload local API (find/findByID/create/update over plain
// arrays) rather than mocking each call individually — the pipeline touches
// six collections across multiple phases, so a tiny fake DB is far more
// legible than a wall of `vi.fn()` return-value wiring. It supports exactly
// the `where` shapes evaluate.ts issues: `and`/`or`, and per-field
// `equals`/`in`/`exists`.

type Doc = Record<string, unknown> & { id: string }

/** A minimal in-memory stand-in for the Payload local API. */
class FakePayload {
  collections: Record<string, Doc[]> = {
    'catalog-entities': [],
    'catalog-relations': [],
    scorecards: [],
    'scorecard-rules': [],
    'scorecard-rule-results': [],
    'entity-scores': [],
    'entity-types': [],
  }
  private counter = 1

  private nextId(collection: string): string {
    return `${collection}-${this.counter++}`
  }

  async find({
    collection,
    where,
    limit = 100,
    page = 1,
    depth = 0,
  }: {
    collection: string
    where?: unknown
    limit?: number
    page?: number
    depth?: number
  }) {
    const all = (this.collections[collection] ?? []).filter((d) => matchesWhere(d, where))
    const start = (page - 1) * limit
    let docs = all.slice(start, start + limit)
    const hasNextPage = start + limit < all.length

    // Depth-1 population for catalog-relations: resolve `from`/`to` ids to
    // their catalog-entities docs so target-kind checks can read `.kind`.
    if (depth >= 1 && collection === 'catalog-relations') {
      docs = docs.map((d) => ({ ...d, from: this.populate(d.from), to: this.populate(d.to) }))
    }
    return { docs, hasNextPage }
  }

  private populate(idOrDoc: unknown): unknown {
    if (typeof idOrDoc !== 'string') return idOrDoc
    return this.collections['catalog-entities'].find((e) => e.id === idOrDoc) ?? idOrDoc
  }

  async findByID({ collection, id }: { collection: string; id: string }) {
    const doc = (this.collections[collection] ?? []).find((d) => d.id === id)
    if (!doc) throw new Error(`${collection}/${id} not found`)
    return doc
  }

  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const doc = { id: this.nextId(collection), ...data } as Doc
    this.collections[collection] = this.collections[collection] ?? []
    this.collections[collection].push(doc)
    return doc
  }

  async update({
    collection,
    id,
    data,
  }: {
    collection: string
    id: string
    data: Record<string, unknown>
  }) {
    const list = this.collections[collection] ?? []
    const idx = list.findIndex((d) => d.id === id)
    if (idx === -1) throw new Error(`${collection}/${id} not found`)
    list[idx] = { ...list[idx], ...data }
    return list[idx]
  }

  async delete({ collection, id, where }: { collection: string; id?: string; where?: unknown }) {
    const list = this.collections[collection] ?? []
    const removed = list.filter((doc) => (id ? doc.id === id : matchesWhere(doc, where)))
    this.collections[collection] = list.filter((doc) => !removed.includes(doc))
    return id ? removed[0] : { docs: removed, totalDocs: removed.length }
  }
}

/** Match a doc against the subset of Payload `Where` shapes evaluate.ts uses. */
function matchesWhere(doc: Doc, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) return (w.and as unknown[]).every((clause) => matchesWhere(doc, clause))
  if (Array.isArray(w.or)) return (w.or as unknown[]).some((clause) => matchesWhere(doc, clause))

  for (const [field, condRaw] of Object.entries(w)) {
    const cond = condRaw as Record<string, unknown>
    const raw = doc[field]
    const actualId = raw && typeof raw === 'object' ? (raw as Doc).id : raw
    if ('equals' in cond) {
      if (actualId !== cond.equals) return false
    } else if ('in' in cond) {
      if (!(cond.in as unknown[]).includes(actualId)) return false
    } else if ('exists' in cond) {
      const exists = raw !== undefined && raw !== null
      if (exists !== cond.exists) return false
    }
  }
  return true
}

/** Find every `scope: 'overall'` entity-scores row for an entity. */
function overallRowFor(fp: FakePayload, entityId: string) {
  return fp.collections['entity-scores'].find((r) => r.scope === 'overall' && r.entity === entityId)
}

/** Find a `scope: 'scorecard'` entity-scores row for (entity, scorecard). */
function scorecardRowFor(fp: FakePayload, entityId: string, scorecardId: string) {
  return fp.collections['entity-scores'].find(
    (r) => r.scope === 'scorecard' && r.entity === entityId && r.scorecard === scorecardId,
  )
}

describe('recomputeWorkspaceScores — coverage invariant', () => {
  it('upserts an overall row (base-value fallback) for EVERY catalog entity, even with no scorecards at all', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [
      { id: 'e1', kind: 'service', workspace: 'ws1' },
      { id: 'e2', kind: 'service', workspace: 'ws1' },
      { id: 'e3', kind: 'kafka-topic', workspace: 'ws1' },
    ]

    const result = await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    expect(result.entitiesScored).toBe(3)
    const overallRows = fp.collections['entity-scores'].filter((r) => r.scope === 'overall')
    expect(overallRows).toHaveLength(3)
    for (const row of overallRows) {
      // No entity-types row exists for either kind -> the built-in default
      // baseValue (50) is the fallback, and golden-path alignment is 100
      // (nothing was expected of it).
      expect(row.score).toBe(50)
      expect(row.baseValue).toBe(50)
      expect(row.goldenPathAlignment).toBe(100)
    }
  })

  it("falls back to each kind's own entity-types baseValue, not a shared default", async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [
      { id: 'svc1', kind: 'service', workspace: 'ws1' },
      { id: 'topic1', kind: 'kafka-topic', workspace: 'ws1' },
    ]
    fp.collections['entity-types'] = [
      { id: 'et1', workspace: 'ws1', kind: 'service', baseValue: 70, scoringWeight: 1 },
    ]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    expect(overallRowFor(fp, 'svc1')?.score).toBe(70) // customized
    expect(overallRowFor(fp, 'topic1')?.score).toBe(50) // built-in default (no row)
  })

  it('is idempotent: re-running produces the same rows, not duplicates', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')
    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    expect(fp.collections['entity-scores'].filter((r) => r.scope === 'overall')).toHaveLength(1)
  })
})

describe('recomputeWorkspaceScores — per-scorecard score math', () => {
  it('a scorecard score matches computeScorecardScore over its stored rule results, and REPLACES the baseline in overall', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]
    // A non-default baseValue proves overall doesn't blend it in once a
    // scorecard applies — it should equal the scorecard score exactly.
    fp.collections['entity-types'] = [
      { id: 'et1', workspace: 'ws1', kind: 'service', baseValue: 90, scoringWeight: 1 },
    ]
    fp.collections['scorecards'] = [
      { id: 'sc1', workspace: 'ws1', levels: [{ name: 'Bronze', rank: 1 }] },
    ]
    fp.collections['scorecard-rules'] = [
      { id: 'r1', scorecard: 'sc1', weight: 1, level: null },
      { id: 'r2', scorecard: 'sc1', weight: 1, level: null },
    ]
    fp.collections['scorecard-rule-results'] = [
      { id: 'res1', workspace: 'ws1', scorecard: 'sc1', rule: 'r1', entity: 'e1', passed: true },
      { id: 'res2', workspace: 'ws1', scorecard: 'sc1', rule: 'r2', entity: 'e1', passed: false },
    ]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    const scRow = scorecardRowFor(fp, 'e1', 'sc1')
    expect(scRow?.score).toBe(50) // 1 of 2 equal-weight rules passed
    expect(scRow?.passedRules).toBe(1)
    expect(scRow?.totalRules).toBe(2)
    // Base rule (r2, untagged) failed -> no ladder level achieved.
    expect(scRow?.levelName).toBeNull()

    const overall = overallRowFor(fp, 'e1')
    expect(overall?.score).toBe(50) // == the one applicable scorecard's score, not blended with baseValue 90
    expect(overall?.baseValue).toBe(90) // still carried for transparency
  })

  it('weighted rules: a heavier passed rule dominates the scorecard score', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]
    fp.collections['scorecards'] = [{ id: 'sc1', workspace: 'ws1', levels: [] }]
    fp.collections['scorecard-rules'] = [
      { id: 'r1', scorecard: 'sc1', weight: 9 },
      { id: 'r2', scorecard: 'sc1', weight: 1 },
    ]
    fp.collections['scorecard-rule-results'] = [
      { id: 'res1', workspace: 'ws1', scorecard: 'sc1', rule: 'r1', entity: 'e1', passed: true },
      { id: 'res2', workspace: 'ws1', scorecard: 'sc1', rule: 'r2', entity: 'e1', passed: false },
    ]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    expect(scorecardRowFor(fp, 'e1', 'sc1')?.score).toBe(90)
  })

  it('ignores a stored result whose rule was deleted directly', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]
    fp.collections.scorecards = [{ id: 'sc1', workspace: 'ws1', levels: [] }]
    fp.collections['scorecard-rule-results'] = [
      {
        id: 'orphaned-result',
        workspace: 'ws1',
        scorecard: 'sc1',
        rule: 'deleted-rule',
        entity: 'e1',
        passed: true,
      },
    ]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1', { captureSnapshots: false })

    expect(scorecardRowFor(fp, 'e1', 'sc1')).toBeUndefined()
    expect(overallRowFor(fp, 'e1')?.score).toBe(50)
  })

  it('golden-path alignment counts requiredRelations + requiredMetadata expectations met', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [
      { id: 'e1', kind: 'service', workspace: 'ws1', metadata: { costCenter: 'CC-1' } },
      { id: 'team1', kind: 'team', workspace: 'ws1' },
    ]
    fp.collections['catalog-relations'] = [
      { id: 'rel1', workspace: 'ws1', from: 'e1', to: 'team1', type: 'owns' },
    ]
    fp.collections['entity-types'] = [
      {
        id: 'et1',
        workspace: 'ws1',
        kind: 'service',
        baseValue: 50,
        scoringWeight: 1,
        goldenPath: {
          requiredRelations: [
            { relationType: 'owns', direction: 'from', targetKind: 'team', min: 1 },
          ],
          requiredMetadata: [{ path: 'metadata.costCenter' }],
        },
      },
    ]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    expect(overallRowFor(fp, 'e1')?.goldenPathAlignment).toBe(100) // both expectations met
  })

  it('golden-path alignment: partial compliance rounds like computeGoldenPathAlignment', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }] // no metadata, no relations
    fp.collections['entity-types'] = [
      {
        id: 'et1',
        workspace: 'ws1',
        kind: 'service',
        baseValue: 50,
        scoringWeight: 1,
        goldenPath: {
          requiredRelations: [{ relationType: 'owns', direction: 'from', min: 1 }],
          requiredMetadata: [{ path: 'metadata.costCenter' }],
        },
      },
    ]

    await recomputeWorkspaceScores(fp as unknown as Payload, 'ws1')

    expect(overallRowFor(fp, 'e1')?.goldenPathAlignment).toBe(0) // neither expectation met
  })
})

describe('runScorecardEvaluation — entity-score rule integration', () => {
  it('clears all projections and restores baseline scores when a scorecard is disabled', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]
    fp.collections.scorecards = [{ id: 'sc1', workspace: 'ws1', enabled: false, levels: [] }]
    fp.collections['scorecard-rules'] = [
      {
        id: 'r1',
        scorecard: 'sc1',
        type: 'field-presence',
        weight: 1,
        expression: { path: 'kind', op: 'exists' },
      },
    ]
    fp.collections['scorecard-rule-results'] = [
      { id: 'rr1', workspace: 'ws1', scorecard: 'sc1', rule: 'r1', entity: 'e1', passed: true },
    ]
    fp.collections['entity-scores'] = [
      {
        id: 'es1',
        workspace: 'ws1',
        entity: 'e1',
        scope: 'scorecard',
        scorecard: 'sc1',
        score: 100,
      },
      { id: 'es2', workspace: 'ws1', entity: 'e1', scope: 'overall', scorecard: null, score: 100 },
    ]

    const summary = await runScorecardEvaluation(fp as unknown as Payload, 'sc1', {
      captureSnapshots: false,
    })

    expect(summary).toEqual({
      scorecardId: 'sc1',
      entitiesEvaluated: 0,
      rulesEvaluated: 0,
      resultsWritten: 0,
    })
    expect(fp.collections['scorecard-rule-results']).toHaveLength(0)
    expect(scorecardRowFor(fp, 'e1', 'sc1')).toBeUndefined()
    expect(overallRowFor(fp, 'e1')?.score).toBe(50)
  })

  it('removes results and score rows for deleted rules and entities no longer matched by appliesTo', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [
      { id: 'service-1', kind: 'service', workspace: 'ws1' },
      { id: 'api-1', kind: 'api', workspace: 'ws1' },
    ]
    fp.collections.scorecards = [
      { id: 'sc1', workspace: 'ws1', enabled: true, appliesTo: { kind: 'service' }, levels: [] },
    ]
    fp.collections['scorecard-rules'] = [
      {
        id: 'current-rule',
        scorecard: 'sc1',
        type: 'field-presence',
        weight: 1,
        expression: { path: 'kind', op: 'exists' },
      },
    ]
    fp.collections['scorecard-rule-results'] = [
      {
        id: 'stale-entity-result',
        workspace: 'ws1',
        scorecard: 'sc1',
        rule: 'current-rule',
        entity: 'api-1',
        passed: true,
      },
      {
        id: 'deleted-rule-result',
        workspace: 'ws1',
        scorecard: 'sc1',
        rule: 'deleted-rule',
        entity: 'service-1',
        passed: true,
      },
    ]
    fp.collections['entity-scores'] = [
      {
        id: 'stale-api-score',
        workspace: 'ws1',
        entity: 'api-1',
        scope: 'scorecard',
        scorecard: 'sc1',
        score: 100,
      },
    ]

    await runScorecardEvaluation(fp as unknown as Payload, 'sc1')

    expect(fp.collections['scorecard-rule-results']).toEqual([
      expect.objectContaining({ scorecard: 'sc1', rule: 'current-rule', entity: 'service-1' }),
    ])
    expect(scorecardRowFor(fp, 'api-1', 'sc1')).toBeUndefined()
    expect(overallRowFor(fp, 'api-1')?.score).toBe(50)
    expect(scorecardRowFor(fp, 'service-1', 'sc1')?.score).toBe(100)
  })

  it("an entity-score rule (target=related) compiles a related entity's already-scored overall value", async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [
      { id: 'svcY', kind: 'service', workspace: 'ws1' },
      { id: 'svcX', kind: 'service', workspace: 'ws1' },
    ]
    fp.collections['catalog-relations'] = [
      { id: 'rel1', workspace: 'ws1', from: 'svcX', to: 'svcY', type: 'depends-on' },
    ]
    fp.collections['scorecards'] = [
      {
        id: 'scY',
        workspace: 'ws1',
        appliesTo: { filter: { id: { equals: 'svcY' } } },
        levels: [],
      },
      {
        id: 'scX',
        workspace: 'ws1',
        appliesTo: { filter: { id: { equals: 'svcX' } } },
        levels: [],
      },
    ]
    fp.collections['scorecard-rules'] = [
      // Always-true threshold rule so svcY scores 100 on its own scorecard.
      {
        id: 'ruleY1',
        scorecard: 'scY',
        type: 'threshold',
        weight: 1,
        expression: { path: 'kind', op: 'eq', value: 'service' },
      },
      // svcX's own scorecard is entirely an entity-score rule over its
      // depends-on target's overall score.
      {
        id: 'ruleXscore',
        scorecard: 'scX',
        type: 'entity-score',
        weight: 1,
        expression: {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'min',
          scoreScope: 'overall',
          op: 'gte',
          value: 70,
        },
      },
    ]

    // Score svcY first so svcX's entity-score rule has a real (non-fallback) value to read.
    await runScorecardEvaluation(fp as unknown as Payload, 'scY')
    expect(overallRowFor(fp, 'svcY')?.score).toBe(100)

    await runScorecardEvaluation(fp as unknown as Payload, 'scX')

    const ruleResult = fp.collections['scorecard-rule-results'].find(
      (r) => r.entity === 'svcX' && r.rule === 'ruleXscore',
    )
    expect(ruleResult?.passed).toBe(true) // min([100]) >= 70

    const scXRow = scorecardRowFor(fp, 'svcX', 'scX')
    expect(scXRow?.score).toBe(100) // the entity-score rule itself is the only rule -> all-or-nothing
    expect(overallRowFor(fp, 'svcX')?.score).toBe(100) // folded into svcX's own overall
  })

  it('single-pass semantics: when the related entity has not been scored yet, entity-score reads its coverage-invariant baseline (not a live recompute)', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [
      { id: 'svcY', kind: 'service', workspace: 'ws1' }, // never scored by any scorecard
      { id: 'svcX', kind: 'service', workspace: 'ws1' },
    ]
    fp.collections['catalog-relations'] = [
      { id: 'rel1', workspace: 'ws1', from: 'svcX', to: 'svcY', type: 'depends-on' },
    ]
    fp.collections['scorecards'] = [
      {
        id: 'scX',
        workspace: 'ws1',
        appliesTo: { filter: { id: { equals: 'svcX' } } },
        levels: [],
      },
    ]
    fp.collections['scorecard-rules'] = [
      {
        id: 'ruleXscore',
        scorecard: 'scX',
        type: 'entity-score',
        weight: 1,
        expression: {
          target: 'related',
          relationType: 'depends-on',
          direction: 'from',
          aggregate: 'min',
          scoreScope: 'overall',
          op: 'gte',
          value: 70,
        },
      },
    ]

    await runScorecardEvaluation(fp as unknown as Payload, 'scX')

    // svcY was never explicitly scored, but the coverage invariant seeds its
    // overall row at the built-in baseValue (50) as a side effect of scX's
    // own run — which is below the rule's threshold of 70.
    expect(overallRowFor(fp, 'svcY')?.score).toBe(50)
    const ruleResult = fp.collections['scorecard-rule-results'].find(
      (r) => r.entity === 'svcX' && r.rule === 'ruleXscore',
    )
    expect(ruleResult?.passed).toBe(false)
  })

  it('a scorecard made only of non-score rules still recomputes entity-scores (no entity-score rules -> phases C/D skipped)', async () => {
    const fp = new FakePayload()
    fp.collections['catalog-entities'] = [{ id: 'e1', kind: 'service', workspace: 'ws1' }]
    fp.collections['scorecards'] = [{ id: 'sc1', workspace: 'ws1', levels: [] }]
    fp.collections['scorecard-rules'] = [
      {
        id: 'r1',
        scorecard: 'sc1',
        type: 'field-presence',
        weight: 1,
        expression: { path: 'kind', op: 'exists' },
      },
    ]

    const summary = await runScorecardEvaluation(fp as unknown as Payload, 'sc1')

    expect(summary.entitiesEvaluated).toBe(1)
    expect(summary.rulesEvaluated).toBe(1)
    expect(overallRowFor(fp, 'e1')?.score).toBe(100) // one rule, passed
  })
})
