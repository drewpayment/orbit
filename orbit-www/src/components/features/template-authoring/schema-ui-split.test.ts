import { describe, expect, it } from 'vitest'
import {
  expressionCapableFieldNames,
  isExpressionCapable,
  mergeProperty,
  parameterPageToSchemaFormPage,
  splitProperty,
  stepInputSchemaToSchemaFormPage,
} from './schema-ui-split'

describe('splitProperty / mergeProperty', () => {
  it('splits inline ui: keys from schema keys', () => {
    const { schema, ui } = splitProperty({
      type: 'string',
      pattern: '^[a-z]+$',
      'ui:help': 'kebab-case',
      'ui:field': 'OrbitTeamPicker',
    })
    expect(schema).toEqual({ type: 'string', pattern: '^[a-z]+$' })
    expect(ui).toEqual({ 'ui:help': 'kebab-case', 'ui:field': 'OrbitTeamPicker' })
  })

  it('round-trips through merge', () => {
    const original = { type: 'boolean', default: true, 'ui:visibleIf': '${{ parameters.x }}' }
    const { schema, ui } = splitProperty(original)
    expect(mergeProperty(schema, ui)).toEqual(original)
  })

  it('handles a property with no ui: keys', () => {
    const { schema, ui } = splitProperty({ type: 'string' })
    expect(schema).toEqual({ type: 'string' })
    expect(ui).toEqual({})
  })
})

describe('parameterPageToSchemaFormPage', () => {
  it('produces a SchemaForm-ready page with separated uiSchema', () => {
    const page = parameterPageToSchemaFormPage({
      title: 'Service',
      required: ['name'],
      properties: {
        name: { type: 'string', 'ui:help': 'kebab-case' },
        owner: { type: 'string', 'ui:field': 'OrbitTeamPicker' },
        plain: { type: 'boolean' },
      },
    })
    expect(page.title).toBe('Service')
    expect(page.schema.required).toEqual(['name'])
    expect(page.schema.properties?.name).toEqual({ type: 'string' })
    expect(page.uiSchema?.name).toEqual({ 'ui:help': 'kebab-case' })
    expect(page.uiSchema?.owner).toEqual({ 'ui:field': 'OrbitTeamPicker' })
    // a field with no ui:* keys gets no uiSchema entry
    expect(page.uiSchema && 'plain' in page.uiSchema).toBe(false)
  })
})

describe('stepInputSchemaToSchemaFormPage', () => {
  it('wraps a registry inputSchema as a single-page form', () => {
    const page = stepInputSchemaToSchemaFormPage('Configure step', {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
    expect(page.title).toBe('Configure step')
    expect(page.schema.properties).toEqual({ name: { type: 'string' } })
    expect(page.schema.required).toEqual(['name'])
    // a property with no ui:* keys gets no uiSchema entry
    expect(page.uiSchema && 'name' in page.uiSchema).toBe(false)
  })

  it('splits an inline ui:widget on a registry property into uiSchema (e.g. api:schema:register\'s `content` textarea hint)', () => {
    const page = stepInputSchemaToSchemaFormPage('Configure step', {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string', minLength: 1, 'ui:widget': 'textarea' },
      },
      required: ['name', 'content'],
    })
    expect(page.schema.properties?.content).toEqual({ type: 'string', minLength: 1 })
    expect(page.uiSchema?.content).toEqual({ 'ui:widget': 'textarea' })
  })
})

describe('isExpressionCapable / expressionCapableFieldNames', () => {
  it('flags string/number/integer as expression-capable', () => {
    expect(isExpressionCapable({ type: 'string' })).toBe(true)
    expect(isExpressionCapable({ type: 'number' })).toBe(true)
    expect(isExpressionCapable({ type: 'integer' })).toBe(true)
    expect(isExpressionCapable({ type: 'boolean' })).toBe(false)
    expect(isExpressionCapable(undefined)).toBe(false)
  })

  it('lists only expression-capable field names', () => {
    const names = expressionCapableFieldNames({
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        enabled: { type: 'boolean' },
      },
    })
    expect(names.sort()).toEqual(['count', 'name'])
  })
})
