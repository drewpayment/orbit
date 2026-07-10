import { describe, it, expect } from 'vitest'
import { validateGraphQL } from './schema-validators'

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
