import { describe, expect, it } from 'vitest'
import { evaluateVisibleIf } from '../visible-if'

/**
 * Table tests copied verbatim from `orbit-www/src/components/forms/schema-form/visible-if.test.ts`
 * (PR #103, `feat/schema-form`) — this module MUST stay behaviourally
 * aligned with that one. See the module docblock for why there are two
 * copies for now.
 */
describe('evaluateVisibleIf', () => {
  it('is visible when there is no expression', () => {
    expect(evaluateVisibleIf(undefined, {})).toBe(true)
  })

  it('evaluates a truthy boolean field reference', () => {
    expect(evaluateVisibleIf('${{ parameters.enabled }}', { enabled: true })).toBe(true)
    expect(evaluateVisibleIf('${{ parameters.enabled }}', { enabled: false })).toBe(false)
  })

  it('evaluates a truthy string field reference (non-empty string is truthy)', () => {
    expect(evaluateVisibleIf('${{ parameters.name }}', { name: 'x' })).toBe(true)
    expect(evaluateVisibleIf('${{ parameters.name }}', { name: '' })).toBe(false)
  })

  it('evaluates equality', () => {
    expect(evaluateVisibleIf("${{ parameters.foo == 'bar' }}", { foo: 'bar' })).toBe(true)
    expect(evaluateVisibleIf("${{ parameters.foo == 'bar' }}", { foo: 'baz' })).toBe(false)
  })

  it('evaluates negation', () => {
    expect(evaluateVisibleIf('${{ !parameters.enabled }}', { enabled: false })).toBe(true)
    expect(evaluateVisibleIf('${{ !parameters.enabled }}', { enabled: true })).toBe(false)
  })

  it('defaults to hidden when the referenced field is missing', () => {
    expect(evaluateVisibleIf('${{ parameters.missing }}', {})).toBe(false)
  })

  it('fails open (visible) on a malformed expression', () => {
    expect(evaluateVisibleIf('${{ parameters.foo ===== }}', { foo: 'bar' })).toBe(true)
    expect(evaluateVisibleIf('not an expression at all', {})).toBe(true)
  })

  it('supports numeric equality', () => {
    expect(evaluateVisibleIf('${{ parameters.count == 3 }}', { count: 3 })).toBe(true)
    expect(evaluateVisibleIf('${{ parameters.count == 3 }}', { count: 4 })).toBe(false)
  })
})
