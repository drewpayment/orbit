import { describe, expect, it } from 'vitest'
import { inputSchemaToJsonSchema } from './input-schema-to-json-schema'
import type { ActionInputSchema } from './input-schema'

describe('inputSchemaToJsonSchema', () => {
  it('converts a text field', () => {
    const schema: ActionInputSchema = {
      fields: [{ name: 'repoName', label: 'Repo name', type: 'text', required: true, help: 'help text' }],
    }
    const { schema: jsonSchema, uiSchema } = inputSchemaToJsonSchema(schema)
    expect(jsonSchema.properties?.repoName).toMatchObject({ type: 'string', title: 'Repo name' })
    expect(jsonSchema.required).toEqual(['repoName'])
    expect(uiSchema.repoName).toMatchObject({ 'ui:help': 'help text' })
  })

  it('converts a textarea field to ui:widget textarea', () => {
    const schema: ActionInputSchema = {
      fields: [{ name: 'notes', label: 'Notes', type: 'textarea' }],
    }
    const { jsonSchema, uiSchema } = { jsonSchema: inputSchemaToJsonSchema(schema).schema, uiSchema: inputSchemaToJsonSchema(schema).uiSchema }
    expect(jsonSchema.properties?.notes).toMatchObject({ type: 'string' })
    expect(uiSchema.notes).toMatchObject({ 'ui:widget': 'textarea' })
  })

  it('converts a number field', () => {
    const schema: ActionInputSchema = { fields: [{ name: 'count', label: 'Count', type: 'number' }] }
    const { schema: jsonSchema } = inputSchemaToJsonSchema(schema)
    expect(jsonSchema.properties?.count).toMatchObject({ type: 'number' })
  })

  it('converts a boolean field', () => {
    const schema: ActionInputSchema = { fields: [{ name: 'dryRun', label: 'Dry run', type: 'boolean' }] }
    const { schema: jsonSchema } = inputSchemaToJsonSchema(schema)
    expect(jsonSchema.properties?.dryRun).toMatchObject({ type: 'boolean' })
  })

  it('converts a select field to a string enum', () => {
    const schema: ActionInputSchema = {
      fields: [{ name: 'env', label: 'Environment', type: 'select', options: ['staging', 'prod'] }],
    }
    const { schema: jsonSchema } = inputSchemaToJsonSchema(schema)
    expect(jsonSchema.properties?.env).toMatchObject({ type: 'string', enum: ['staging', 'prod'] })
  })

  it('carries placeholder through to ui:placeholder', () => {
    const schema: ActionInputSchema = {
      fields: [{ name: 'x', label: 'X', type: 'text', placeholder: 'type here' }],
    }
    const { uiSchema } = inputSchemaToJsonSchema(schema)
    expect(uiSchema.x).toMatchObject({ 'ui:placeholder': 'type here' })
  })

  it('handles an empty field list', () => {
    const { schema } = inputSchemaToJsonSchema({ fields: [] })
    expect(schema.properties).toEqual({})
    expect(schema.required ?? []).toEqual([])
  })
})
