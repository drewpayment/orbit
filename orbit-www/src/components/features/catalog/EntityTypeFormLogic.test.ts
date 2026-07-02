import { describe, expect, it } from 'vitest'
import {
  buildSaveEntityTypeInput,
  clampNumber,
  parseBaseValue,
  parseScoringWeight,
  sanitiseRequiredMetadata,
  sanitiseRequiredRelations,
  validateEntityTypeForm,
  type EntityTypeFormState,
  type RequiredRelationRow,
} from './EntityTypeFormLogic'

describe('clampNumber', () => {
  it('clamps within range', () => {
    expect(clampNumber(150, 0, 100, 50)).toBe(100)
    expect(clampNumber(-10, 0, 100, 50)).toBe(0)
    expect(clampNumber(42, 0, 100, 50)).toBe(42)
  })

  it('falls back when not finite', () => {
    expect(clampNumber(NaN, 0, 100, 50)).toBe(50)
    expect(clampNumber(Infinity, 0, 100, 50)).toBe(50)
  })
})

describe('parseBaseValue', () => {
  it('parses and clamps a string into 0-100', () => {
    expect(parseBaseValue('70')).toBe(70)
    expect(parseBaseValue('150')).toBe(100)
    expect(parseBaseValue('-5')).toBe(0)
  })

  it('a base value of 0 is respected, not treated as missing', () => {
    expect(parseBaseValue('0')).toBe(0)
  })

  it('blank/non-numeric input falls back to the default (50)', () => {
    expect(parseBaseValue('')).toBe(50)
    expect(parseBaseValue('abc')).toBe(50)
  })

  it('rounds fractional input', () => {
    expect(parseBaseValue('70.6')).toBe(71)
  })
})

describe('parseScoringWeight', () => {
  it('parses a non-negative weight', () => {
    expect(parseScoringWeight('2')).toBe(2)
    expect(parseScoringWeight('0')).toBe(0)
  })

  it('a negative value clamps to the 0 floor (not the default)', () => {
    expect(parseScoringWeight('-1')).toBe(0)
  })

  it('blank input falls back to the default (1)', () => {
    expect(parseScoringWeight('')).toBe(1)
  })
})

describe('sanitiseRequiredRelations', () => {
  it('drops rows with an unrecognised or blank relation type', () => {
    const rows: RequiredRelationRow[] = [
      { relationType: 'not-a-real-type', direction: 'either', targetKind: '', min: '1' },
      { relationType: '', direction: 'either', targetKind: '', min: '1' },
    ]
    expect(sanitiseRequiredRelations(rows)).toEqual([])
  })

  it('keeps valid rows, defaulting direction and narrowing targetKind/min', () => {
    const rows: RequiredRelationRow[] = [
      { relationType: 'owns', direction: 'from', targetKind: 'team', min: '2' },
    ]
    expect(sanitiseRequiredRelations(rows)).toEqual([
      { relationType: 'owns', direction: 'from', targetKind: 'team', min: 2 },
    ])
  })

  it('an unrecognised targetKind becomes null (any kind)', () => {
    const rows: RequiredRelationRow[] = [
      { relationType: 'owns', direction: 'either', targetKind: 'not-a-kind', min: '1' },
    ]
    expect(sanitiseRequiredRelations(rows)[0].targetKind).toBeNull()
  })

  it('an unrecognised direction falls back to "either"', () => {
    const rows: RequiredRelationRow[] = [
      { relationType: 'owns', direction: 'sideways' as RequiredRelationRow['direction'], targetKind: '', min: '1' },
    ]
    expect(sanitiseRequiredRelations(rows)[0].direction).toBe('either')
  })

  it('a blank or negative min clamps to a non-negative integer, defaulting to 1', () => {
    const rows: RequiredRelationRow[] = [
      { relationType: 'owns', direction: 'either', targetKind: '', min: '' },
      { relationType: 'owns', direction: 'either', targetKind: '', min: '-3' },
    ]
    const out = sanitiseRequiredRelations(rows)
    expect(out[0].min).toBe(1)
    expect(out[1].min).toBe(0)
  })
})

describe('sanitiseRequiredMetadata', () => {
  it('drops rows with a blank path', () => {
    expect(sanitiseRequiredMetadata([{ path: '  ', label: 'Cost center' }])).toEqual([])
  })

  it('trims path and normalises a blank label to null', () => {
    expect(sanitiseRequiredMetadata([{ path: ' metadata.tier ', label: '  ' }])).toEqual([
      { path: 'metadata.tier', label: null },
    ])
  })

  it('keeps a non-blank label, trimmed', () => {
    expect(sanitiseRequiredMetadata([{ path: 'metadata.tier', label: ' Tier ' }])).toEqual([
      { path: 'metadata.tier', label: 'Tier' },
    ])
  })
})

describe('validateEntityTypeForm', () => {
  it('requires a non-blank display name', () => {
    expect(validateEntityTypeForm({ displayName: '' })).toMatch(/display name/i)
    expect(validateEntityTypeForm({ displayName: '   ' })).toMatch(/display name/i)
  })

  it('passes for a non-blank display name', () => {
    expect(validateEntityTypeForm({ displayName: 'Backend Service' })).toBeNull()
  })
})

describe('buildSaveEntityTypeInput', () => {
  const emptyGoldenPath: EntityTypeFormState['goldenPath'] = {
    summary: '',
    docsUrl: '',
    requiredRelations: [],
    requiredMetadata: [],
  }

  it('builds a well-formed payload from a fully populated form', () => {
    const form: EntityTypeFormState = {
      displayName: '  Backend Service  ',
      description: '  Long-running backend processes.  ',
      baseValue: '70',
      scoringWeight: '2',
      goldenPath: {
        summary: '  Deploy via the platform template.  ',
        docsUrl: '  https://docs.example.com/paved-road/service  ',
        requiredRelations: [{ relationType: 'owns', direction: 'from', targetKind: 'team', min: '1' }],
        requiredMetadata: [{ path: 'metadata.costCenter', label: 'Cost center' }],
      },
    }

    expect(buildSaveEntityTypeInput('service', form)).toEqual({
      kind: 'service',
      displayName: 'Backend Service',
      description: 'Long-running backend processes.',
      baseValue: 70,
      scoringWeight: 2,
      goldenPath: {
        summary: 'Deploy via the platform template.',
        docsUrl: 'https://docs.example.com/paved-road/service',
        requiredRelations: [{ relationType: 'owns', direction: 'from', targetKind: 'team', min: 1 }],
        requiredMetadata: [{ path: 'metadata.costCenter', label: 'Cost center' }],
      },
    })
  })

  it('blank optional fields become null, empty arrays stay empty', () => {
    const form: EntityTypeFormState = {
      displayName: 'API',
      description: '',
      baseValue: '',
      scoringWeight: '',
      goldenPath: emptyGoldenPath,
    }

    expect(buildSaveEntityTypeInput('api', form)).toEqual({
      kind: 'api',
      displayName: 'API',
      description: null,
      baseValue: 50,
      scoringWeight: 1,
      goldenPath: {
        summary: null,
        docsUrl: null,
        requiredRelations: [],
        requiredMetadata: [],
      },
    })
  })
})
