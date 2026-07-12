import { describe, it, expect } from 'vitest'
import { validateGraphQL, validateSchemaByType } from './schema-validators'

describe('validateGraphQL', () => {
  it('treats empty content as valid', () => {
    expect(validateGraphQL('')).toEqual({ valid: true, errors: [] })
    expect(validateGraphQL('   \n  ')).toEqual({ valid: true, errors: [] })
  })

  it('accepts valid SDL', () => {
    const sdl = `
      type Query {
        user(id: ID!): User
      }
      type User {
        id: ID!
        name: String!
      }
    `
    expect(validateGraphQL(sdl)).toEqual({ valid: true, errors: [] })
  })

  it('rejects unparseable SDL with a line/message error', () => {
    const result = validateGraphQL('type Query { this is not valid')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toEqual(expect.any(String))
    expect(result.errors[0].line).toEqual(expect.any(Number))
  })

  it('rejects a dangling type keyword with no body', () => {
    const result = validateGraphQL('type')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// Dispatch coverage for the edit page (edit-api-client.tsx), which validates
// live content by schemaType rather than always assuming OpenAPI (WI6).
describe('validateSchemaByType', () => {
  it('dispatches graphql content to validateGraphQL, accepting valid SDL', () => {
    const sdl = 'type Query {\n  user(id: ID!): String\n}\n'
    expect(validateSchemaByType(sdl, 'graphql')).toEqual({ valid: true, errors: [] })
  })

  it('dispatches graphql content to validateGraphQL, rejecting broken SDL with a line/message error', () => {
    const result = validateSchemaByType('type Query { this is not valid', 'graphql')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toEqual(expect.any(String))
  })

  it('dispatches openapi content to the OpenAPI validator', () => {
    const result = validateSchemaByType('{}', 'openapi')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('OpenAPI'))).toBe(true)
  })

  it('dispatches asyncapi content to the AsyncAPI validator', () => {
    const result = validateSchemaByType('{}', 'asyncapi')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('asyncapi'))).toBe(true)
  })
})
