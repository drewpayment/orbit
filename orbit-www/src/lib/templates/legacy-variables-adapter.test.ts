import { describe, expect, it } from 'vitest'
import { templateVariablesToJsonSchema, type TemplateVariable } from './legacy-variables-adapter'

describe('templateVariablesToJsonSchema', () => {
  it('converts a string variable', () => {
    const { schema } = templateVariablesToJsonSchema([
      { key: 'projectName', type: 'string', required: true, description: 'Name of the project' },
    ])
    expect(schema.properties?.projectName).toMatchObject({
      type: 'string',
      title: 'projectName',
      description: 'Name of the project',
    })
    expect(schema.required).toEqual(['projectName'])
  })

  it('converts a number variable', () => {
    const { schema } = templateVariablesToJsonSchema([
      { key: 'port', type: 'number', required: false, default: 8080 },
    ])
    expect(schema.properties?.port).toMatchObject({ type: 'number', default: 8080 })
    expect(schema.required ?? []).not.toContain('port')
  })

  it('converts a boolean variable', () => {
    const { schema } = templateVariablesToJsonSchema([
      { key: 'enableCi', type: 'boolean', required: false, default: true },
    ])
    expect(schema.properties?.enableCi).toMatchObject({ type: 'boolean', default: true })
  })

  it('converts a select variable to a string enum', () => {
    const { schema } = templateVariablesToJsonSchema([
      {
        key: 'license',
        type: 'select',
        required: true,
        options: [
          { label: 'MIT', value: 'mit' },
          { label: 'Apache 2.0', value: 'apache-2.0' },
        ],
      },
    ])
    expect(schema.properties?.license).toMatchObject({ type: 'string', enum: ['mit', 'apache-2.0'] })
  })

  it('converts a multiselect variable to an array of a string enum (fixes the comma-separated hack)', () => {
    const { schema } = templateVariablesToJsonSchema([
      {
        key: 'features',
        type: 'multiselect',
        required: false,
        options: [
          { label: 'Auth', value: 'auth' },
          { label: 'Billing', value: 'billing' },
        ],
      },
    ])
    expect(schema.properties?.features).toMatchObject({
      type: 'array',
      items: { type: 'string', enum: ['auth', 'billing'] },
    })
  })

  it('produces a defaults object matching legacy UseTemplateForm behavior', () => {
    const { defaults } = templateVariablesToJsonSchema([
      { key: 'a', type: 'string', required: false },
      { key: 'b', type: 'boolean', required: false },
      { key: 'c', type: 'number', required: false },
      { key: 'd', type: 'string', required: false, default: 'preset' },
    ])
    expect(defaults).toEqual({ a: '', b: false, c: 0, d: 'preset' })
  })

  it('defaults a multiselect variable to an empty array, not an empty string', () => {
    const { defaults } = templateVariablesToJsonSchema([
      {
        key: 'features',
        type: 'multiselect',
        required: false,
        options: [{ label: 'Auth', value: 'auth' }],
      },
    ])
    expect(defaults).toEqual({ features: [] })
  })

  it('round-trips multiple variables into one object schema', () => {
    const vars: TemplateVariable[] = [
      { key: 'name', type: 'string', required: true },
      { key: 'isPrivate', type: 'boolean', required: false, default: true },
    ]
    const { schema } = templateVariablesToJsonSchema(vars)
    expect(Object.keys(schema.properties ?? {})).toEqual(['name', 'isPrivate'])
  })
})
