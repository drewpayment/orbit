import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { FieldComponentProps } from './field-registry'
import {
  BooleanSwitchField,
  createFieldRegistry,
  isKeyValueObjectSchema,
  KeyValueObjectField,
  NumberInputField,
  SelectField,
  StringInputField,
  TagInputField,
  TextareaField,
} from './field-registry'

afterEach(() => {
  cleanup()
})

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

  it('resolves an object with no properties and a scalar additionalProperties → KeyValueObjectField', () => {
    const registry = createFieldRegistry()
    expect(
      registry.resolve({ type: 'object', additionalProperties: { type: 'string' } }),
    ).toBe(KeyValueObjectField)
  })

  it('resolves a bare `{ type: object }` (no properties, no additionalProperties) → KeyValueObjectField', () => {
    const registry = createFieldRegistry()
    expect(registry.resolve({ type: 'object' })).toBe(KeyValueObjectField)
  })

  it('an object WITH properties does not resolve to KeyValueObjectField', () => {
    const registry = createFieldRegistry()
    expect(
      registry.resolve({ type: 'object', properties: { name: { type: 'string' } } }),
    ).not.toBe(KeyValueObjectField)
  })
})

describe('isKeyValueObjectSchema', () => {
  it('is true for no properties + scalar additionalProperties', () => {
    expect(isKeyValueObjectSchema({ type: 'object', additionalProperties: { type: 'string' } })).toBe(true)
  })

  it('is true for no properties + additionalProperties: true', () => {
    expect(isKeyValueObjectSchema({ type: 'object', additionalProperties: true })).toBe(true)
  })

  it('is true for no properties + no additionalProperties at all', () => {
    expect(isKeyValueObjectSchema({ type: 'object' })).toBe(true)
  })

  it('is false when additionalProperties is false', () => {
    expect(isKeyValueObjectSchema({ type: 'object', additionalProperties: false })).toBe(false)
  })

  it('is false when the object has explicit properties', () => {
    expect(
      isKeyValueObjectSchema({ type: 'object', properties: { a: { type: 'string' } } }),
    ).toBe(false)
  })

  it('is false for non-object schemas', () => {
    expect(isKeyValueObjectSchema({ type: 'string' })).toBe(false)
  })
})

describe('KeyValueObjectField', () => {
  it('renders an existing map as key/value rows', () => {
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{ greeting: 'hi', name: 'world' }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('greeting')).toBeInTheDocument()
    expect(screen.getByDisplayValue('hi')).toBeInTheDocument()
    expect(screen.getByDisplayValue('name')).toBeInTheDocument()
    expect(screen.getByDisplayValue('world')).toBeInTheDocument()
  })

  it('renders no entries with an add-entry affordance for an empty map', () => {
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{}}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/no entries/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add entry/i })).toBeInTheDocument()
  })

  it('adds a new row with a unique placeholder key and emits it', () => {
    const onChange = vi.fn()
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{}}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add entry/i }))
    expect(onChange).toHaveBeenCalledWith({ key: '' })
  })

  it('removes a row via its remove button', () => {
    const onChange = vi.fn()
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{ a: '1', b: '2' }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /remove entry/i })[0])
    expect(onChange).toHaveBeenCalledWith({ b: '2' })
  })

  it('editing a row value emits the payload with the updated value, keys unchanged', () => {
    const onChange = vi.fn()
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{ a: '1' }}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith({ a: '2' })
  })

  it('renaming a key to one that already exists shows a duplicate-key error and does not emit', () => {
    const onChange = vi.fn()
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{ a: '1', b: '2' }}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByDisplayValue('b'), { target: { value: 'a' } })
    expect(screen.getAllByText(/duplicate key/i).length).toBeGreaterThan(0)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a non-scalar existing value renders read-only as JSON instead of an editable input', () => {
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: true }}
        value={{ nested: { a: 1 } }}
        onChange={vi.fn()}
      />,
    )
    const readOnlyInput = screen.getByDisplayValue('{"a":1}')
    expect(readOnlyInput).toHaveAttribute('readonly')
  })

  it('uses a caller-provided valueField component to render each row value (expression-aware editors)', () => {
    function FakeExpressionField({ value, onChange }: FieldComponentProps) {
      return (
        <input
          data-testid="fake-expression-field"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    }
    render(
      <KeyValueObjectField
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        value={{ a: '${{ parameters.x }}' }}
        onChange={vi.fn()}
        valueField={FakeExpressionField}
      />,
    )
    expect(screen.getByTestId('fake-expression-field')).toHaveValue('${{ parameters.x }}')
  })
})
