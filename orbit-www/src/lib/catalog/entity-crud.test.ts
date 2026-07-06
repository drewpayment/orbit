import { describe, it, expect } from 'vitest'
import {
  slugify,
  uniqueSlug,
  validateLinks,
  validateCreateInput,
  validateUpdatePatch,
  validateRelationInput,
  PROJECTION_LOCKED_FIELDS,
  CURATION_FIELDS,
  type CreateEntityInput,
} from './entity-crud'

describe('slugify', () => {
  it.each([
    ['Payments Service', 'payments-service'],
    ['  Trim  Me  ', 'trim-me'],
    ['Special!@#Chars', 'special-chars'],
    ['Café Über', 'cafe-uber'],
    ['', ''],
  ])('slugifies %j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('handles null/undefined', () => {
    expect(slugify(null)).toBe('')
    expect(slugify(undefined)).toBe('')
  })
})

describe('uniqueSlug', () => {
  it('returns the base when free', () => {
    expect(uniqueSlug('payments', [])).toBe('payments')
    expect(uniqueSlug('payments', ['other'])).toBe('payments')
  })

  it('suffixes to the first free -N (starting at 2)', () => {
    expect(uniqueSlug('payments', ['payments'])).toBe('payments-2')
    expect(uniqueSlug('payments', ['payments', 'payments-2'])).toBe('payments-3')
  })

  it('skips gaps to the first actually-free suffix', () => {
    expect(uniqueSlug('payments', ['payments', 'payments-3'])).toBe('payments-2')
  })

  it('accepts a Set as well as an array', () => {
    expect(uniqueSlug('payments', new Set(['payments']))).toBe('payments-2')
  })
})

describe('field-ownership constants', () => {
  it('locks identity fields and curates the rest with no overlap', () => {
    expect(PROJECTION_LOCKED_FIELDS).toContain('name')
    expect(PROJECTION_LOCKED_FIELDS).toContain('workspace')
    expect(PROJECTION_LOCKED_FIELDS).toContain('health')
    expect(CURATION_FIELDS).toContain('description')
    expect(CURATION_FIELDS).toContain('links')
    const overlap = PROJECTION_LOCKED_FIELDS.filter((f) =>
      (CURATION_FIELDS as readonly string[]).includes(f),
    )
    expect(overlap).toEqual([])
  })
})

describe('validateLinks', () => {
  it('passes for absent/empty links', () => {
    expect(validateLinks(undefined)).toBeNull()
    expect(validateLinks([])).toBeNull()
  })

  it('passes for well-formed http(s) links', () => {
    expect(validateLinks([{ label: 'Docs', url: 'https://x.dev' }])).toBeNull()
    expect(validateLinks([{ label: 'Docs', url: 'http://x.dev' }])).toBeNull()
  })

  it('requires a label', () => {
    expect(validateLinks([{ label: '', url: 'https://x.dev' }])).toMatch(/label/i)
  })

  it('requires a url', () => {
    expect(validateLinks([{ label: 'Docs', url: '' }])).toMatch(/URL/i)
  })

  it('rejects a non-http url', () => {
    expect(validateLinks([{ label: 'Docs', url: 'ftp://x.dev' }])).toMatch(/http/i)
  })
})

describe('validateCreateInput', () => {
  const base: CreateEntityInput = { kind: 'service', name: 'Payments', workspaceId: 'ws-1' }

  it('passes for a valid manual create (incl. global workspaceId=null)', () => {
    expect(validateCreateInput(base)).toBeNull()
    expect(validateCreateInput({ ...base, workspaceId: null })).toBeNull()
  })

  it('requires a name', () => {
    expect(validateCreateInput({ ...base, name: '  ' })).toMatch(/name/i)
  })

  it('requires a valid kind', () => {
    expect(validateCreateInput({ ...base, kind: 'bogus' as CreateEntityInput['kind'] })).toMatch(
      /kind/i,
    )
  })

  it('surfaces link errors', () => {
    expect(validateCreateInput({ ...base, links: [{ label: 'x', url: 'nope' }] })).toMatch(/http/i)
  })
})

describe('validateUpdatePatch', () => {
  it('allows any curation edit on a manual entity', () => {
    expect(
      validateUpdatePatch('manual', { name: 'New', kind: 'api', description: 'd' }),
    ).toBeNull()
  })

  it('rejects an identity-field edit on a projected entity', () => {
    expect(validateUpdatePatch('apps', { name: 'Renamed' })).toMatch(/synced|source/i)
    expect(validateUpdatePatch('apps', { kind: 'api' })).toMatch(/synced|source/i)
  })

  it('allows curation edits on a projected entity', () => {
    expect(
      validateUpdatePatch('apps', { description: 'human note', links: [], tier: 'tier-1' }),
    ).toBeNull()
  })

  it('rejects an empty name on a manual entity', () => {
    expect(validateUpdatePatch('manual', { name: '   ' })).toMatch(/empty/i)
  })
})

describe('validateRelationInput', () => {
  it('passes a valid relation', () => {
    expect(validateRelationInput({ fromId: 'a', toId: 'b', type: 'depends-on' })).toBeNull()
  })

  it('rejects self-relations', () => {
    expect(validateRelationInput({ fromId: 'a', toId: 'a', type: 'depends-on' })).toMatch(/itself/i)
  })

  it('rejects an unknown type', () => {
    expect(
      validateRelationInput({
        fromId: 'a',
        toId: 'b',
        type: 'bogus' as ReturnType<() => never>,
      }),
    ).toMatch(/type/i)
  })

  it('requires both ids', () => {
    expect(validateRelationInput({ fromId: '', toId: 'b', type: 'depends-on' })).toMatch(/required/i)
  })
})
