import { describe, it, expect } from 'vitest'
import { normalizeInputSchema, validateInputs, type ActionInputSchema } from './input-schema'

describe('normalizeInputSchema', () => {
  it('degrades malformed input to { fields: [] }', () => {
    expect(normalizeInputSchema(null)).toEqual({ fields: [] })
    expect(normalizeInputSchema(undefined)).toEqual({ fields: [] })
    expect(normalizeInputSchema(42)).toEqual({ fields: [] })
    expect(normalizeInputSchema('not json {')).toEqual({ fields: [] })
    expect(normalizeInputSchema({ nope: true })).toEqual({ fields: [] })
  })

  it('parses a JSON string column', () => {
    const raw = JSON.stringify({ fields: [{ name: 'a', label: 'A', type: 'text' }] })
    expect(normalizeInputSchema(raw)).toEqual({ fields: [{ name: 'a', label: 'A', type: 'text' }] })
  })

  it('accepts a bare array of fields', () => {
    expect(normalizeInputSchema([{ name: 'a', type: 'text' }])).toEqual({
      fields: [{ name: 'a', label: 'a', type: 'text' }],
    })
  })

  it('drops fields without a name, defaults label to name, and falls back to text type', () => {
    const result = normalizeInputSchema({
      fields: [
        { label: 'no name' },
        { name: 'x', type: 'bogus' },
        { name: 'y', label: 'Y', type: 'number', required: true },
      ],
    })
    expect(result.fields).toEqual([
      { name: 'x', label: 'x', type: 'text' },
      { name: 'y', label: 'Y', type: 'number', required: true },
    ])
  })

  it('keeps options only for select fields and trims blanks', () => {
    const result = normalizeInputSchema({
      fields: [
        { name: 's', type: 'select', options: ['a', '  b  ', '', 3] },
        { name: 't', type: 'text', options: ['ignored'] },
      ],
    })
    expect(result.fields[0]).toEqual({ name: 's', label: 's', type: 'select', options: ['a', 'b'] })
    expect(result.fields[1]).toEqual({ name: 't', label: 't', type: 'text' })
  })
})

describe('validateInputs', () => {
  const schema: ActionInputSchema = {
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'count', label: 'Count', type: 'number' },
      { name: 'enabled', label: 'Enabled', type: 'boolean' },
      { name: 'env', label: 'Env', type: 'select', options: ['dev', 'prod'] },
    ],
  }

  it('validates trivially with a null/empty schema', () => {
    expect(validateInputs(null, { anything: 1 })).toEqual({ ok: true, values: {} })
    expect(validateInputs({ fields: [] }, {})).toEqual({ ok: true, values: {} })
  })

  it('rejects a missing required field', () => {
    const r = validateInputs(schema, { name: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Name/)
  })

  it('coerces number from a string and rejects non-numeric', () => {
    expect(validateInputs(schema, { name: 'x', count: '42' })).toEqual({
      ok: true,
      values: { name: 'x', count: 42 },
    })
    const bad = validateInputs(schema, { name: 'x', count: 'abc' })
    expect(bad.ok).toBe(false)
  })

  it('coerces boolean from common encodings', () => {
    const r = validateInputs(schema, { name: 'x', enabled: 'true' })
    expect(r).toEqual({ ok: true, values: { name: 'x', enabled: true } })
    const r2 = validateInputs(schema, { name: 'x', enabled: 'off' })
    expect(r2).toEqual({ ok: true, values: { name: 'x', enabled: false } })
  })

  it('enforces select membership', () => {
    expect(validateInputs(schema, { name: 'x', env: 'dev' })).toEqual({
      ok: true,
      values: { name: 'x', env: 'dev' },
    })
    const bad = validateInputs(schema, { name: 'x', env: 'qa' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/dev, prod/)
  })

  it('drops unknown keys and skips optional empty fields', () => {
    const r = validateInputs(schema, { name: 'x', extra: 'nope', count: '' })
    expect(r).toEqual({ ok: true, values: { name: 'x' } })
  })
})
