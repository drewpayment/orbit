import { describe, it, expect } from 'vitest'
import type { DiscoveredEntity } from '@/payload-types'
import { importedHref, proposalDisplayName } from './discovery-ui'

function row(partial: Partial<DiscoveredEntity> = {}): DiscoveredEntity {
  return {
    id: 'd1',
    repo: { owner: 'acme', name: 'billing' },
    path: '',
    detectedKind: 'service',
    confidence: 'high',
    proposal: {},
    status: 'proposed',
    dedupeKey: 'key-1',
    updatedAt: '2026-07-09T00:00:00.000Z',
    createdAt: '2026-07-09T00:00:00.000Z',
    ...partial,
  } as DiscoveredEntity
}

describe('proposalDisplayName', () => {
  it('prefers the prefilled proposal name', () => {
    expect(proposalDisplayName(row({ proposal: { name: 'afi-website' } }))).toBe('afi-website')
  })

  it('falls back to the repo name when the proposal has no name', () => {
    expect(proposalDisplayName(row({ proposal: {}, repo: { owner: 'x', name: 'afiusa' } }))).toBe(
      'afiusa',
    )
  })

  it('falls back to the path, then the dedupe key', () => {
    expect(proposalDisplayName(row({ proposal: {}, repo: undefined, path: 'services/api' }))).toBe(
      'services/api',
    )
    expect(
      proposalDisplayName(row({ proposal: {}, repo: undefined, path: '', dedupeKey: 'abc123' })),
    ).toBe('abc123')
  })

  it('ignores a blank proposal name', () => {
    expect(proposalDisplayName(row({ proposal: { name: '   ' }, repo: { owner: 'x', name: 'repo' } }))).toBe(
      'repo',
    )
  })
})

describe('importedHref', () => {
  it('maps each importable collection to its detail route', () => {
    expect(importedHref('apps', 'a1')).toBe('/apps/a1')
    expect(importedHref('catalog-entities', 'c1')).toBe('/catalog/c1')
    expect(importedHref('api-schemas', 's1')).toBe('/catalog/apis/s1')
  })

  it('returns null when the ref is incomplete (legacy collectionSlug-only rows)', () => {
    expect(importedHref('apps', undefined)).toBeNull()
    expect(importedHref('apps', null)).toBeNull()
    expect(importedHref(undefined, 'a1')).toBeNull()
    expect(importedHref(null, null)).toBeNull()
  })

  it('returns null for a collection with no user-facing detail route', () => {
    expect(importedHref('some-other-collection', 'x1')).toBeNull()
  })
})
