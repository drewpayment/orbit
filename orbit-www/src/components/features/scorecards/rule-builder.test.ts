import { describe, it, expect } from 'vitest'
import {
  buildExpression,
  validateExpression,
  parseExpression,
  coerceScalar,
  defaultForm,
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
    for (const type of ['field-presence', 'relation-check', 'threshold'] as const) {
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
})
