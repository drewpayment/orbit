import { describe, it, expect } from 'vitest'
import { resolveInputMapping, extractTemplatePaths } from './input-mapping'
import type { RuleResultChangedEvent } from './events'

const event: RuleResultChangedEvent = {
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

describe('resolveInputMapping', () => {
  it('returns {} for a non-object mapping', () => {
    expect(resolveInputMapping(null, event)).toEqual({})
    expect(resolveInputMapping('nope', event)).toEqual({})
    expect(resolveInputMapping(42, event)).toEqual({})
    expect(resolveInputMapping([], event)).toEqual({})
  })

  it('passes through non-string values unchanged', () => {
    expect(resolveInputMapping({ n: 5, b: true, o: { x: 1 } }, event)).toEqual({
      n: 5,
      b: true,
      o: { x: 1 },
    })
  })

  it('substitutes a whole-value template preserving the source type', () => {
    const out = resolveInputMapping(
      { service: '{{entity.slug}}', wasPassing: '{{previousPassed}}', nowPassing: '{{passed}}' },
      event,
    )
    expect(out.service).toBe('billing')
    expect(out.wasPassing).toBe(true) // boolean preserved, not "true"
    expect(out.nowPassing).toBe(false)
  })

  it('interpolates mixed text into a string', () => {
    const out = resolveInputMapping(
      { reason: 'Rule "{{rule.title}}" failing on {{entity.name}}' },
      event,
    )
    expect(out.reason).toBe('Rule "Has owner" failing on Billing')
  })

  it('renders a missing path as empty string in mixed text', () => {
    const out = resolveInputMapping({ msg: 'x={{entity.nope}}y' }, event)
    expect(out.msg).toBe('x=y')
  })

  it('yields undefined for a whole-value template pointing at a missing path', () => {
    const out = resolveInputMapping({ v: '{{entity.nope}}' }, event)
    expect(out.v).toBeUndefined()
  })

  it('tolerates surrounding whitespace inside the braces', () => {
    const out = resolveInputMapping({ service: '{{ entity.slug }}' }, event)
    expect(out.service).toBe('billing')
  })
})

describe('extractTemplatePaths', () => {
  it('returns each template path in order', () => {
    expect(extractTemplatePaths('hi {{entity.slug}} {{rule.title}}')).toEqual([
      'entity.slug',
      'rule.title',
    ])
  })

  it('trims whitespace inside the braces', () => {
    expect(extractTemplatePaths('{{  entity.name  }}')).toEqual(['entity.name'])
  })

  it('returns [] when there are no templates', () => {
    expect(extractTemplatePaths('just a literal value')).toEqual([])
  })

  it('ignores a stray, unclosed {{ that is not a full token', () => {
    expect(extractTemplatePaths('cost is {{ but no close')).toEqual([])
  })

  it('returns [] for a non-string value', () => {
    expect(extractTemplatePaths(undefined as unknown as string)).toEqual([])
    expect(extractTemplatePaths(42 as unknown as string)).toEqual([])
  })

  it('captures repeated and adjacent tokens', () => {
    expect(extractTemplatePaths('{{a}}{{a}}{{b}}')).toEqual(['a', 'a', 'b'])
  })
})
