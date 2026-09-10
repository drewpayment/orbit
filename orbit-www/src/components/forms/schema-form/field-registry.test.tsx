import { describe, expect, it } from 'vitest'
import type { FieldComponentProps } from './field-registry'
import {
  BooleanSwitchField,
  createFieldRegistry,
  NumberInputField,
  SelectField,
  StringInputField,
  TagInputField,
  TextareaField,
} from './field-registry'

function Custom(_props: FieldComponentProps) {
  return null
}

describe('field registry resolution precedence', () => {
  it('resolves string → StringInputField by default', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'string' })).toBe(StringInputField)
  })

  it('resolves string+enum → SelectField', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'string', enum: ['a', 'b'] })).toBe(SelectField)
  })

  it('resolves number+enum → SelectField (any type with a non-empty enum uses Select)', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'number', enum: [1, 2, 3] })).toBe(SelectField)
  })

  it('resolves integer+enum → SelectField', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'integer', enum: [1, 2, 3] })).toBe(SelectField)
  })

  it('resolves number/integer → NumberInputField', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'number' })).toBe(NumberInputField)
    expect(registry.resolve({ type: 'integer' })).toBe(NumberInputField)
  })

  it('resolves boolean → BooleanSwitchField', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'boolean' })).toBe(BooleanSwitchField)
  })

  it('resolves array-of-string → TagInputField', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'array', items: { type: 'string' } })).toBe(TagInputField)
  })

  it('ui:widget overrides the type default', () => {
    const registry = createFieldRegistry()
    expect(
      registry.resolve({ type: 'string' }, { 'ui:widget': 'textarea' }),
    ).toBe(TextareaField)
  })

  it('a registered format takes precedence over the type default but not ui:widget', () => {
    const registry = createFieldRegistry()
    registry.register('format:custom-format', Custom)
    expect(registry.resolve({ type: 'string', format: 'custom-format' })).toBe(Custom)
    // ui:widget still wins over format.
    expect(
      registry.resolve(
        { type: 'string', format: 'custom-format' },
        { 'ui:widget': 'textarea' },
      ),
    ).toBe(TextareaField)
  })

  it('ui:field takes precedence over everything else', () => {
    const registry = createFieldRegistry()
    registry.register('OrbitTeamPicker', Custom)
    expect(
      registry.resolve(
        { type: 'string', enum: ['a'], format: 'custom-format' },
        { 'ui:field': 'OrbitTeamPicker', 'ui:widget': 'textarea' },
      ),
    ).toBe(Custom)
  })

  it('registerField added via one registry does not leak into a sibling registry', () => {
    const a = createFieldRegistry()
    const b = createFieldRegistry()
    a.register('OnlyOnA', Custom)
    expect(a.resolve({ type: 'string' }, { 'ui:field': 'OnlyOnA' })).toBe(Custom)
    // Falls back to the type default rather than throwing when unregistered.
    expect(b.resolve({ type: 'string' }, { 'ui:field': 'OnlyOnA' })).toBe(StringInputField)
  })
})
