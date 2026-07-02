import { describe, it, expect } from 'vitest'
import {
  buildExpression,
  validateExpression,
  parseExpression,
  coerceScalar,
  defaultForm,
  fieldByPath,
  valueInputType,
  thresholdOpsForPath,
  SCOREABLE_FIELDS,
  type RuleForm,
} from './rule-builder'

/**
 * Round-trip contract for the rule expression builder/validator (IDP refocus P2).
 * The builder must only ever emit expressions that the validator accepts, and the
 * validator must reject the malformed shapes the evaluator cannot interpret.
 */

describe('coerceScalar', () => {
  it('coerces numeric strings to numbers, leaves text alone', () => {
    expect(coerceScalar('3')).toBe(3)
    expect(coerceScalar(' 12.5 ')).toBe(12.5)
    expect(coerceScalar('-7')).toBe(-7)
    expect(coerceScalar('prod')).toBe('prod')
    expect(coerceScalar('3 replicas')).toBe('3 replicas')
    expect(coerceScalar('')).toBe('')
  })
})

describe('buildExpression → validateExpression round-trip', () => {
  it('field-presence builds the documented shape and validates', () => {
    const form: RuleForm = { type: 'field-presence', path: ' owner ', op: 'not-empty' }
    const expr = buildExpression(form)
    expect(expr).toEqual({ path: 'owner', op: 'not-empty' })
    expect(validateExpression('field-presence', expr)).toBeNull()
  })

  it('relation-check builds with min/direction and omits a blank targetKind', () => {
    const form: RuleForm = {
      type: 'relation-check',
      relationType: 'owns',
      direction: 'from',
      targetKind: '',
      min: 2,
    }
    const expr = buildExpression(form)
    expect(expr).toEqual({ relationType: 'owns', direction: 'from', min: 2 })
    expect(expr).not.toHaveProperty('targetKind')
    expect(validateExpression('relation-check', expr)).toBeNull()
  })

  it('relation-check keeps a provided targetKind', () => {
    const form: RuleForm = {
      type: 'relation-check',
      relationType: 'depends-on',
      direction: 'either',
      targetKind: 'service',
      min: 1,
    }
    const expr = buildExpression(form)
    expect(expr).toEqual({
      relationType: 'depends-on',
      direction: 'either',
      min: 1,
      targetKind: 'service',
    })
    expect(validateExpression('relation-check', expr)).toBeNull()
  })

  it('threshold numeric op coerces value to a number', () => {
    const form: RuleForm = { type: 'threshold', path: 'metadata.replicas', op: 'gte', value: '3' }
    const expr = buildExpression(form)
    expect(expr).toEqual({ path: 'metadata.replicas', op: 'gte', value: 3 })
    expect(validateExpression('threshold', expr)).toBeNull()
  })

  it('threshold "in" splits a comma list into a coerced array', () => {
    const form: RuleForm = {
      type: 'threshold',
      path: 'lifecycle',
      op: 'in',
      value: 'production, staging, 2',
    }
    const expr = buildExpression(form)
    expect(expr).toEqual({ path: 'lifecycle', op: 'in', value: ['production', 'staging', 2] })
    expect(validateExpression('threshold', expr)).toBeNull()
  })

  it('every defaultForm produces a valid expression', () => {
    for (const type of ['field-presence', 'relation-check', 'threshold', 'entity-score'] as const) {
      const form = defaultForm(type)
      // field-presence/threshold defaults need a path to be valid; supply one.
      const filled: RuleForm =
        form.type === 'threshold'
          ? { ...form, path: 'owner', value: '1' }
          : form.type === 'field-presence'
            ? { ...form, path: 'owner' }
            : form
      expect(validateExpression(type, buildExpression(filled))).toBeNull()
    }
  })

  it('entity-score (self/overall) builds the minimal shape and validates', () => {
    const form: RuleForm = {
      type: 'entity-score',
      target: 'self',
      scoreScope: 'overall',
      scorecardId: '',
      relationType: 'owns',
      direction: 'either',
      targetKind: '',
      aggregate: 'min',
      op: 'gte',
      value: '70',
    }
    const expr = buildExpression(form)
    expect(expr).toEqual({ target: 'self', scoreScope: 'overall', aggregate: 'min', op: 'gte', value: 70 })
    expect(expr).not.toHaveProperty('scorecardId')
    expect(expr).not.toHaveProperty('relationType')
    expect(validateExpression('entity-score', expr)).toBeNull()
  })

  it('entity-score (scorecard scope) includes the trimmed scorecardId', () => {
    const form: RuleForm = {
      type: 'entity-score',
      target: 'self',
      scoreScope: 'scorecard',
      scorecardId: ' sc-123 ',
      relationType: 'owns',
      direction: 'either',
      targetKind: '',
      aggregate: 'avg',
      op: 'eq',
      value: '100',
    }
    const expr = buildExpression(form)
    expect(expr).toEqual({
      target: 'self',
      scoreScope: 'scorecard',
      scorecardId: 'sc-123',
      aggregate: 'avg',
      op: 'eq',
      value: 100,
    })
    expect(validateExpression('entity-score', expr)).toBeNull()
  })

  it('entity-score (related) includes relation fields and omits a blank targetKind', () => {
    const form: RuleForm = {
      type: 'entity-score',
      target: 'related',
      scoreScope: 'overall',
      scorecardId: '',
      relationType: 'depends-on',
      direction: 'from',
      targetKind: '',
      aggregate: 'min',
      op: 'gte',
      value: '80',
    }
    const expr = buildExpression(form)
    expect(expr).toEqual({
      target: 'related',
      scoreScope: 'overall',
      relationType: 'depends-on',
      direction: 'from',
      aggregate: 'min',
      op: 'gte',
      value: 80,
    })
    expect(expr).not.toHaveProperty('targetKind')
    expect(validateExpression('entity-score', expr)).toBeNull()
  })

  it('entity-score (related) keeps a provided targetKind', () => {
    const form: RuleForm = {
      type: 'entity-score',
      target: 'related',
      scoreScope: 'overall',
      scorecardId: '',
      relationType: 'depends-on',
      direction: 'either',
      targetKind: 'service',
      aggregate: 'max',
      op: 'lt',
      value: '50',
    }
    const expr = buildExpression(form)
    expect(expr).toMatchObject({ targetKind: 'service' })
    expect(validateExpression('entity-score', expr)).toBeNull()
  })
})

describe('validateExpression rejects malformed expressions', () => {
  it('rejects a non-object expression', () => {
    expect(validateExpression('field-presence', null)).toMatch(/object/i)
    expect(validateExpression('threshold', 'nope')).toMatch(/object/i)
  })

  it('field-presence: missing path and bad op', () => {
    expect(validateExpression('field-presence', { path: '', op: 'exists' })).toMatch(/path/i)
    expect(validateExpression('field-presence', { path: 'owner', op: 'bogus' })).toMatch(/op/i)
  })

  it('relation-check: missing/unknown relationType and bad min', () => {
    expect(validateExpression('relation-check', { relationType: '' })).toMatch(/relation type/i)
    expect(validateExpression('relation-check', { relationType: 'not-a-rel' })).toMatch(/unknown relation/i)
    expect(
      validateExpression('relation-check', { relationType: 'owns', min: -1 }),
    ).toMatch(/min/i)
    expect(
      validateExpression('relation-check', { relationType: 'owns', targetKind: 'goblin' }),
    ).toMatch(/target kind/i)
  })

  it('threshold: missing path, bad op, non-numeric numeric-op, empty in-list', () => {
    expect(validateExpression('threshold', { path: '', op: 'eq', value: 1 })).toMatch(/path/i)
    expect(validateExpression('threshold', { path: 'x', op: 'bogus', value: 1 })).toMatch(/operator/i)
    expect(validateExpression('threshold', { path: 'x', op: 'gt', value: 'abc' })).toMatch(/numeric/i)
    expect(validateExpression('threshold', { path: 'x', op: 'in', value: [] })).toMatch(/list/i)
    expect(validateExpression('threshold', { path: 'x', op: 'eq', value: '' })).toMatch(/value/i)
  })

  it('rejects an unknown rule type', () => {
    expect(validateExpression('mystery', { foo: 1 })).toMatch(/unknown rule type/i)
  })

  it('entity-score: bad target and bad scoreScope', () => {
    expect(
      validateExpression('entity-score', { target: 'nope', scoreScope: 'overall', aggregate: 'min', op: 'gte', value: 50 }),
    ).toMatch(/target/i)
    expect(
      validateExpression('entity-score', { target: 'self', scoreScope: 'nope', aggregate: 'min', op: 'gte', value: 50 }),
    ).toMatch(/scoreScope/i)
  })

  it('entity-score: scoreScope "scorecard" requires a scorecardId', () => {
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'scorecard',
        aggregate: 'min',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/scorecard is required/i)
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'scorecard',
        scorecardId: '  ',
        aggregate: 'min',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/scorecard is required/i)
  })

  it('entity-score: target "related" requires a known relationType', () => {
    expect(
      validateExpression('entity-score', {
        target: 'related',
        scoreScope: 'overall',
        aggregate: 'min',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/relation type is required/i)
    expect(
      validateExpression('entity-score', {
        target: 'related',
        scoreScope: 'overall',
        relationType: 'not-a-rel',
        aggregate: 'min',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/unknown relation type/i)
  })

  it('entity-score: unknown targetKind and bad direction are rejected', () => {
    expect(
      validateExpression('entity-score', {
        target: 'related',
        scoreScope: 'overall',
        relationType: 'owns',
        targetKind: 'goblin',
        aggregate: 'min',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/target kind/i)
    expect(
      validateExpression('entity-score', {
        target: 'related',
        scoreScope: 'overall',
        relationType: 'owns',
        direction: 'sideways',
        aggregate: 'min',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/direction/i)
  })

  it('entity-score: bad aggregate and bad op are rejected', () => {
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'overall',
        aggregate: 'median',
        op: 'gte',
        value: 50,
      }),
    ).toMatch(/aggregate/i)
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'overall',
        aggregate: 'min',
        op: 'bogus',
        value: 50,
      }),
    ).toMatch(/op must be/i)
  })

  it('entity-score: value must be numeric and within 0-100', () => {
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'overall',
        aggregate: 'min',
        op: 'gte',
        value: 'abc',
      }),
    ).toMatch(/0 and 100/i)
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'overall',
        aggregate: 'min',
        op: 'gte',
        value: -1,
      }),
    ).toMatch(/0 and 100/i)
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'overall',
        aggregate: 'min',
        op: 'gte',
        value: 101,
      }),
    ).toMatch(/0 and 100/i)
    expect(
      validateExpression('entity-score', {
        target: 'self',
        scoreScope: 'overall',
        aggregate: 'min',
        op: 'gte',
        value: '',
      }),
    ).toMatch(/0 and 100/i)
  })
})

describe('parseExpression hydrates builder state for editing', () => {
  it('round-trips a threshold "in" array back to a comma string', () => {
    const form = parseExpression('threshold', { path: 'lifecycle', op: 'in', value: ['a', 'b'] })
    expect(form).toEqual({ type: 'threshold', path: 'lifecycle', op: 'in', value: 'a, b' })
    // and re-building yields a valid expression again
    expect(validateExpression('threshold', buildExpression(form))).toBeNull()
  })

  it('falls back to safe defaults for a missing expression', () => {
    const form = parseExpression('relation-check', null)
    expect(form.type).toBe('relation-check')
    expect(validateExpression('relation-check', buildExpression(form))).toBeNull()
  })

  it('round-trips an entity-score expression back to builder state', () => {
    const stored = {
      target: 'related',
      scoreScope: 'scorecard',
      scorecardId: 'sc-9',
      relationType: 'depends-on',
      direction: 'to',
      targetKind: 'api',
      aggregate: 'avg',
      op: 'lte',
      value: 65,
    }
    const form = parseExpression('entity-score', stored)
    expect(form).toEqual({
      type: 'entity-score',
      target: 'related',
      scoreScope: 'scorecard',
      scorecardId: 'sc-9',
      relationType: 'depends-on',
      direction: 'to',
      targetKind: 'api',
      aggregate: 'avg',
      op: 'lte',
      value: '65',
    })
    expect(validateExpression('entity-score', buildExpression(form))).toBeNull()
  })

  it('entity-score falls back to safe defaults for a missing expression', () => {
    const form = parseExpression('entity-score', null)
    expect(form.type).toBe('entity-score')
    expect(validateExpression('entity-score', buildExpression(form))).toBeNull()
  })
})

describe('scoreable-field catalog', () => {
  it('fieldByPath resolves known fields and ignores unknown ones', () => {
    expect(fieldByPath('lifecycle')?.valueType).toBe('enum')
    expect(fieldByPath('lifecycle')?.enumOptions).toContain('production')
    expect(fieldByPath('owner')?.valueType).toBe('relationship')
    expect(fieldByPath('name')?.valueType).toBe('text')
    expect(fieldByPath('metadata.costCenter')).toBeUndefined()
  })

  it('every scoreable field has a label and (for enums) options', () => {
    for (const field of SCOREABLE_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0)
      if (field.valueType === 'enum') {
        expect(field.enumOptions && field.enumOptions.length).toBeTruthy()
      }
    }
  })

  it('valueInputType maps field types to the right value control', () => {
    expect(valueInputType('lifecycle')).toBe('enum')
    expect(valueInputType('kind')).toBe('enum')
    expect(valueInputType('name')).toBe('text')
    expect(valueInputType('owner')).toBe('text') // relationship → free text id
    expect(valueInputType('metadata.replicas')).toBe('text') // custom → text
  })

  it('thresholdOpsForPath narrows enum fields to eq/neq/in', () => {
    const enumOps = thresholdOpsForPath('lifecycle').map((o) => o.value)
    expect(enumOps).toEqual(['eq', 'neq', 'in'])
    const textOps = thresholdOpsForPath('name').map((o) => o.value)
    expect(textOps).toContain('gt')
    expect(textOps.length).toBeGreaterThan(3)
  })
})

describe('custom / free-entered field paths (combobox)', () => {
  it('a known field path is stored verbatim and resolves its metadata', () => {
    expect(fieldByPath('lifecycle')).toBeDefined()
    const form: RuleForm = { type: 'field-presence', path: 'lifecycle', op: 'exists' }
    const expr = buildExpression(form)
    expect(expr).toEqual({ path: 'lifecycle', op: 'exists' })
    expect(validateExpression('field-presence', expr)).toBeNull()
  })

  it('a free-entered metadata path is accepted verbatim and validates', () => {
    const form: RuleForm = { type: 'field-presence', path: 'metadata.costCenter', op: 'not-empty' }
    const expr = buildExpression(form)
    expect(expr).toEqual({ path: 'metadata.costCenter', op: 'not-empty' })
    expect(validateExpression('field-presence', expr)).toBeNull()
    // unknown path → text value type (no enum dropdown), all threshold ops available
    expect(valueInputType('metadata.costCenter')).toBe('text')
    expect(thresholdOpsForPath('metadata.costCenter').length).toBeGreaterThan(3)
  })

  it('a nested custom path round-trips unchanged through the builder', () => {
    const form: RuleForm = { type: 'threshold', path: 'metadata.sla.uptime', op: 'gte', value: '99' }
    const expr = buildExpression(form)
    expect(expr).toEqual({ path: 'metadata.sla.uptime', op: 'gte', value: 99 })
    expect(validateExpression('threshold', expr)).toBeNull()
  })
})
