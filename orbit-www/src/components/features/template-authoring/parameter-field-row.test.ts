import { describe, expect, it } from 'vitest'
import {
  createParameterFieldRow,
  propertyFromRow,
  rowFromNameAndProperty,
  validateParameterFieldRows,
} from './parameter-field-row'

describe('propertyFromRow', () => {
  it('assembles a minimal string property', () => {
    const row = createParameterFieldRow({ name: 'name', type: 'string' })
    expect(propertyFromRow(row)).toEqual({ type: 'string' })
  })

  it('includes label, help, visibleIf, uiField as ui:* inline keys', () => {
    const row = createParameterFieldRow({
      name: 'owner',
      type: 'string',
      label: 'Owner',
      help: 'Team that owns this',
      visibleIf: '${{ parameters.needsOwner }}',
      uiField: 'OrbitTeamPicker',
    })
    expect(propertyFromRow(row)).toEqual({
      type: 'string',
      title: 'Owner',
      'ui:help': 'Team that owns this',
      'ui:visibleIf': '${{ parameters.needsOwner }}',
      'ui:field': 'OrbitTeamPicker',
    })
  })

  it('parses a boolean default', () => {
    const row = createParameterFieldRow({ name: 'flag', type: 'boolean', defaultValue: 'true' })
    expect(propertyFromRow(row)).toEqual({ type: 'boolean', default: true })
  })

  it('parses a number default and min/max', () => {
    const row = createParameterFieldRow({
      name: 'count',
      type: 'number',
      defaultValue: '3',
      minimum: '1',
      maximum: '10',
    })
    expect(propertyFromRow(row)).toEqual({ type: 'number', default: 3, minimum: 1, maximum: 10 })
  })

  it('includes string validation (pattern/minLength/maxLength/enum)', () => {
    const row = createParameterFieldRow({
      name: 'name',
      type: 'string',
      pattern: '^[a-z]+$',
      minLength: '2',
      maxLength: '10',
      enumOptions: 'a, b, b, c',
    })
    expect(propertyFromRow(row)).toEqual({
      type: 'string',
      pattern: '^[a-z]+$',
      minLength: 2,
      maxLength: 10,
      enum: ['a', 'b', 'b', 'c'],
    })
  })

  it('gives array fields a string items schema', () => {
    const row = createParameterFieldRow({ name: 'tags', type: 'array' })
    expect(propertyFromRow(row)).toEqual({ type: 'array', items: { type: 'string' } })
  })
})

describe('rowFromNameAndProperty / propertyFromRow round-trip', () => {
  it('round-trips a fully-populated property', () => {
    const original = {
      type: 'string' as const,
      title: 'Service name',
      'ui:help': 'kebab-case',
      'ui:visibleIf': '${{ parameters.x }}',
      'ui:field': 'OrbitTeamPicker',
      pattern: '^[a-z]+$',
      minLength: 2,
      maxLength: 10,
      default: 'svc',
    }
    const row = rowFromNameAndProperty('name', original, true)
    expect(row.required).toBe(true)
    expect(propertyFromRow(row)).toEqual(original)
  })
})

describe('validateParameterFieldRows', () => {
  it('flags a missing name', () => {
    const rows = [createParameterFieldRow({ name: '' })]
    expect(validateParameterFieldRows(rows)).toMatch(/needs a field name/)
  })

  it('flags an invalid name', () => {
    const rows = [createParameterFieldRow({ name: '1bad' })]
    expect(validateParameterFieldRows(rows)).toMatch(/must start with a letter/)
  })

  it('flags a duplicate name', () => {
    const rows = [createParameterFieldRow({ name: 'a' }), createParameterFieldRow({ name: 'a' })]
    expect(validateParameterFieldRows(rows)).toMatch(/Duplicate field name/)
  })

  it('passes valid unique rows', () => {
    const rows = [createParameterFieldRow({ name: 'a' }), createParameterFieldRow({ name: 'b' })]
    expect(validateParameterFieldRows(rows)).toBeNull()
  })
})
