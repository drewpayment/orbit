import { describe, it, expect } from 'vitest'
import { normalizeInputSchema } from '@/lib/actions/input-schema'
import {
  assembleInputSchema,
  validateBuilderFields,
  parseInputSchemaToBuilderFields,
  moveField,
  createBuilderField,
  type BuilderField,
} from './input-schema-builder'

/**
 * Contract for the Action input-schema builder (IDP refocus P3). The builder
 * must only ever assemble the {@link ActionInputSchema} shape the shared
 * normalizer accepts, and its validator must reject the rows an author should
 * fix before saving.
 */

function field(partial: Partial<BuilderField>): BuilderField {
  return createBuilderField(partial)
}

describe('assembleInputSchema', () => {
  it('trims, defaults label to name, and emits required only when true', () => {
    const schema = assembleInputSchema([
      field({ name: '  repo ', label: '  Repository ', type: 'text', required: true }),
      field({ name: 'notes', label: '', type: 'textarea' }),
    ])
    expect(schema).toEqual({
      fields: [
        { name: 'repo', label: 'Repository', type: 'text', required: true },
        { name: 'notes', label: 'notes', type: 'textarea' },
      ],
    })
  })

  it('drops rows with a blank name', () => {
    const schema = assembleInputSchema([
      field({ name: '', label: 'Orphan', type: 'text' }),
      field({ name: 'keep', type: 'text' }),
    ])
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0].name).toBe('keep')
  })

  it('keeps cleaned options for select and de-duplicates them', () => {
    const schema = assembleInputSchema([
      field({ name: 'env', type: 'select', options: [' prod ', 'staging', 'prod', ''] }),
    ])
    expect(schema.fields[0].options).toEqual(['prod', 'staging'])
  })

  it('drops options for non-select fields', () => {
    const schema = assembleInputSchema([
      field({ name: 'count', type: 'number', options: ['a', 'b'] }),
    ])
    expect(schema.fields[0]).not.toHaveProperty('options')
  })

  it('emits help/placeholder only when non-empty', () => {
    const schema = assembleInputSchema([
      field({ name: 'a', type: 'text', help: '  ', placeholder: 'e.g. foo' }),
    ])
    expect(schema.fields[0]).not.toHaveProperty('help')
    expect(schema.fields[0].placeholder).toBe('e.g. foo')
  })

  it('always produces a value normalizeInputSchema round-trips unchanged', () => {
    const schema = assembleInputSchema([
      field({ name: 'env', label: 'Environment', type: 'select', options: ['prod', 'dev'], required: true }),
      field({ name: 'replicas', label: 'Replicas', type: 'number' }),
    ])
    expect(normalizeInputSchema(schema)).toEqual(schema)
  })
})

describe('validateBuilderFields', () => {
  it('accepts a well-formed list', () => {
    expect(
      validateBuilderFields([
        field({ name: 'repo', type: 'text' }),
        field({ name: 'env', type: 'select', options: ['prod'] }),
      ]),
    ).toBeNull()
  })

  it('rejects a blank field name', () => {
    expect(validateBuilderFields([field({ name: '  ', label: 'Repo', type: 'text' })])).toMatch(
      /needs a field name/i,
    )
  })

  it('rejects names with illegal characters', () => {
    expect(validateBuilderFields([field({ name: 'my field', type: 'text' })])).toMatch(
      /only contain/i,
    )
  })

  it('rejects duplicate names', () => {
    expect(
      validateBuilderFields([
        field({ name: 'env', type: 'text' }),
        field({ name: 'env', type: 'text' }),
      ]),
    ).toMatch(/duplicate/i)
  })

  it('rejects a select with no usable options', () => {
    expect(
      validateBuilderFields([field({ name: 'env', type: 'select', options: ['  ', ''] })]),
    ).toMatch(/at least one option/i)
  })
})

describe('parseInputSchemaToBuilderFields', () => {
  it('hydrates rows (with fresh ids) from a stored schema', () => {
    const rows = parseInputSchemaToBuilderFields({
      fields: [
        { name: 'env', label: 'Environment', type: 'select', options: ['prod', 'dev'], required: true },
        { name: 'notes', type: 'textarea' },
      ],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'env',
      label: 'Environment',
      type: 'select',
      required: true,
      options: ['prod', 'dev'],
    })
    expect(rows[0].id).toBeTruthy()
    expect(rows[1].id).not.toBe(rows[0].id)
    // round-trips back to the same normalized schema
    expect(normalizeInputSchema(assembleInputSchema(rows))).toEqual(
      normalizeInputSchema({
        fields: [
          { name: 'env', label: 'Environment', type: 'select', options: ['prod', 'dev'], required: true },
          { name: 'notes', label: 'notes', type: 'textarea' },
        ],
      }),
    )
  })

  it('degrades a malformed schema to an empty row list', () => {
    expect(parseInputSchemaToBuilderFields('not json {')).toEqual([])
    expect(parseInputSchemaToBuilderFields(null)).toEqual([])
  })
})

describe('moveField', () => {
  const rows = [
    field({ name: 'a', type: 'text' }),
    field({ name: 'b', type: 'text' }),
    field({ name: 'c', type: 'text' }),
  ]

  it('moves a row up and down', () => {
    expect(moveField(rows, 2, -1).map((f) => f.name)).toEqual(['a', 'c', 'b'])
    expect(moveField(rows, 0, 1).map((f) => f.name)).toEqual(['b', 'a', 'c'])
  })

  it('clamps moves at the bounds (no-op, same reference rules)', () => {
    expect(moveField(rows, 0, -1)).toBe(rows)
    expect(moveField(rows, 2, 1)).toBe(rows)
  })
})
