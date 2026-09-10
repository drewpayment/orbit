import { describe, expect, it } from 'vitest'
import { jsonSchemaToZod } from './schema-to-zod'
import { UnsupportedSchemaError, type JsonSchema } from './types'

describe('jsonSchemaToZod', () => {
  describe('string', () => {
    it('accepts a plain string', () => {
      const schema = jsonSchemaToZod({ type: 'string' })
      expect(schema.safeParse('hello').success).toBe(true)
      expect(schema.safeParse(42).success).toBe(false)
    })

    it('enforces minLength/maxLength', () => {
      const schema = jsonSchemaToZod({ type: 'string', minLength: 2, maxLength: 4 })
      expect(schema.safeParse('a').success).toBe(false)
      expect(schema.safeParse('ab').success).toBe(true)
      expect(schema.safeParse('abcde').success).toBe(false)
    })

    it('enforces a pattern', () => {
      const schema = jsonSchemaToZod({ type: 'string', pattern: '^[a-z]+$' })
      expect(schema.safeParse('abc').success).toBe(true)
      expect(schema.safeParse('ABC').success).toBe(false)
    })

    it('enforces format: email', () => {
      const schema = jsonSchemaToZod({ type: 'string', format: 'email' })
      expect(schema.safeParse('a@b.com').success).toBe(true)
      expect(schema.safeParse('not-an-email').success).toBe(false)
    })

    it('enforces an enum', () => {
      const schema = jsonSchemaToZod({ type: 'string', enum: ['a', 'b'] })
      expect(schema.safeParse('a').success).toBe(true)
      expect(schema.safeParse('c').success).toBe(false)
    })
  })

  describe('number / integer', () => {
    it('accepts a plain number', () => {
      const schema = jsonSchemaToZod({ type: 'number' })
      expect(schema.safeParse(1.5).success).toBe(true)
      expect(schema.safeParse('1.5').success).toBe(false)
    })

    it('rejects non-integers for type: integer', () => {
      const schema = jsonSchemaToZod({ type: 'integer' })
      expect(schema.safeParse(2).success).toBe(true)
      expect(schema.safeParse(2.5).success).toBe(false)
    })

    it('enforces minimum/maximum', () => {
      const schema = jsonSchemaToZod({ type: 'number', minimum: 0, maximum: 10 })
      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(5).success).toBe(true)
      expect(schema.safeParse(11).success).toBe(false)
    })

    it('enforces multipleOf', () => {
      const schema = jsonSchemaToZod({ type: 'number', multipleOf: 5 })
      expect(schema.safeParse(10).success).toBe(true)
      expect(schema.safeParse(7).success).toBe(false)
    })
  })

  describe('boolean', () => {
    it('accepts a boolean', () => {
      const schema = jsonSchemaToZod({ type: 'boolean' })
      expect(schema.safeParse(true).success).toBe(true)
      expect(schema.safeParse('true').success).toBe(false)
    })
  })

  describe('array of string', () => {
    it('accepts an array of strings', () => {
      const schema = jsonSchemaToZod({ type: 'array', items: { type: 'string' } })
      expect(schema.safeParse(['a', 'b']).success).toBe(true)
      expect(schema.safeParse([1, 2]).success).toBe(false)
    })

    it('enforces minItems/maxItems', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 2,
      })
      expect(schema.safeParse([]).success).toBe(false)
      expect(schema.safeParse(['a']).success).toBe(true)
      expect(schema.safeParse(['a', 'b', 'c']).success).toBe(false)
    })

    it('enforces uniqueItems', () => {
      const schema = jsonSchemaToZod({ type: 'array', items: { type: 'string' }, uniqueItems: true })
      expect(schema.safeParse(['a', 'a']).success).toBe(false)
      expect(schema.safeParse(['a', 'b']).success).toBe(true)
    })
  })

  describe('object', () => {
    it('converts nested properties and required[]', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      })
      expect(schema.safeParse({ name: 'a' }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(false)
      // Unrequired fields are optional.
      expect(schema.safeParse({ name: 'a', age: undefined }).success).toBe(true)
    })

    it('supports nested objects', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
        required: ['address'],
      })
      expect(schema.safeParse({ address: { city: 'x' } }).success).toBe(true)
      expect(schema.safeParse({ address: {} }).success).toBe(false)
    })
  })

  describe('default', () => {
    it('applies a default value when the field is omitted', () => {
      const schema = jsonSchemaToZod({ type: 'string', default: 'fallback' })
      const parsed = schema.safeParse(undefined)
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data).toBe('fallback')
    })
  })

  describe('unsupported schema shapes', () => {
    const cases: Array<[string, JsonSchema]> = [
      ['oneOf', { oneOf: [{ type: 'string' }, { type: 'number' }] }],
      ['anyOf', { anyOf: [{ type: 'string' }, { type: 'number' }] }],
      ['$ref', { $ref: '#/definitions/Foo' }],
    ]

    it.each(cases)('throws UnsupportedSchemaError for %s', (_label, schema) => {
      expect(() => jsonSchemaToZod(schema)).toThrow(UnsupportedSchemaError)
    })
  })
})
