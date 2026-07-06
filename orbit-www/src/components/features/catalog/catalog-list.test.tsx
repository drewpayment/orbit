import { describe, it, expect } from 'vitest'
import { buildCatalogWhere, isEntityKind, ENTITY_KIND_VALUES } from './catalog-query'

describe('buildCatalogWhere', () => {
  it('always constrains to the caller workspaces (tenant boundary)', () => {
    const where = buildCatalogWhere({ workspaceIds: ['ws1', 'ws2'] })
    expect(where).toEqual({ workspace: { in: ['ws1', 'ws2'] } })
  })

  it('matches nothing when the user has no workspaces (no leak)', () => {
    const where = buildCatalogWhere({ workspaceIds: [] })
    // A sentinel id that cannot exist — never an unconstrained query.
    expect(where).toEqual({ workspace: { in: ['__none__'] } })
  })

  it('ANDs a kind filter with the workspace constraint', () => {
    const where = buildCatalogWhere({ workspaceIds: ['ws1'], kind: 'service' })
    expect(where).toEqual({
      and: [{ workspace: { in: ['ws1'] } }, { kind: { equals: 'service' } }],
    })
  })

  it('ORs name/description for a text query and trims whitespace', () => {
    const where = buildCatalogWhere({ workspaceIds: ['ws1'], query: '  billing  ' })
    expect(where).toEqual({
      and: [
        { workspace: { in: ['ws1'] } },
        { or: [{ name: { contains: 'billing' } }, { description: { contains: 'billing' } }] },
      ],
    })
  })

  it('ignores a blank query', () => {
    const where = buildCatalogWhere({ workspaceIds: ['ws1'], query: '   ' })
    expect(where).toEqual({ workspace: { in: ['ws1'] } })
  })

  it('combines kind + query into a single AND clause', () => {
    const where = buildCatalogWhere({ workspaceIds: ['ws1'], kind: 'api', query: 'orders' })
    expect(where).toEqual({
      and: [
        { workspace: { in: ['ws1'] } },
        { kind: { equals: 'api' } },
        { or: [{ name: { contains: 'orders' } }, { description: { contains: 'orders' } }] },
      ],
    })
  })
})

describe('isEntityKind', () => {
  it('accepts every known kind', () => {
    for (const k of ENTITY_KIND_VALUES) {
      expect(isEntityKind(k)).toBe(true)
    }
  })

  it('rejects unknown / non-string values', () => {
    expect(isEntityKind('nope')).toBe(false)
    expect(isEntityKind(undefined)).toBe(false)
    expect(isEntityKind(42)).toBe(false)
  })
})
