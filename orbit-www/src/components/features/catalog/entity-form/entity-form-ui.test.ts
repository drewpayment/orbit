import { describe, it, expect } from 'vitest'
import {
  LIFECYCLE_OPTIONS,
  TIER_OPTIONS,
  LINK_TYPE_OPTIONS,
  GLOBAL_WORKSPACE_VALUE,
  newLinkRow,
  linksToRows,
  isRowBlank,
  validateLinkRow,
  collectLinkErrors,
  rowsToLinks,
  isSourceLocked,
  sourceProvenanceLabel,
  buildWorkspaceOptions,
  workspaceSelectionToId,
  idToWorkspaceSelection,
} from './entity-form-ui'

describe('option lists', () => {
  it('exposes the three lifecycle values with human labels', () => {
    expect(LIFECYCLE_OPTIONS.map((o) => o.value)).toEqual([
      'experimental',
      'production',
      'deprecated',
    ])
    expect(LIFECYCLE_OPTIONS.every((o) => o.label.length > 0)).toBe(true)
  })

  it('exposes the three tiers', () => {
    expect(TIER_OPTIONS.map((o) => o.value)).toEqual(['tier-1', 'tier-2', 'tier-3'])
  })

  it('exposes the five link types', () => {
    expect(LINK_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'docs',
      'dashboard',
      'runbook',
      'repository',
      'other',
    ])
  })
})

describe('newLinkRow', () => {
  it('creates a blank row with a unique stable key and default type', () => {
    const a = newLinkRow()
    const b = newLinkRow()
    expect(a.key).not.toEqual(b.key)
    expect(a.label).toBe('')
    expect(a.url).toBe('')
    expect(a.type).toBe('docs')
  })

  it('accepts partial overrides', () => {
    const row = newLinkRow({ label: 'Runbook', url: 'https://x.dev', type: 'runbook' })
    expect(row.label).toBe('Runbook')
    expect(row.type).toBe('runbook')
  })
})

describe('linksToRows', () => {
  it('maps persisted entity links to editable rows (defaulting type)', () => {
    const rows = linksToRows([
      { label: 'Docs', url: 'https://docs.dev', type: 'docs', id: 'x' },
      { label: 'Dash', url: 'https://d.dev', type: null, id: 'y' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ label: 'Docs', url: 'https://docs.dev', type: 'docs' })
    expect(rows[1].type).toBe('other')
    expect(rows[0].key).not.toEqual(rows[1].key)
  })

  it('returns an empty array for null/undefined', () => {
    expect(linksToRows(null)).toEqual([])
    expect(linksToRows(undefined)).toEqual([])
  })
})

describe('isRowBlank', () => {
  it('is true only when both label and url are empty/whitespace', () => {
    expect(isRowBlank(newLinkRow())).toBe(true)
    expect(isRowBlank(newLinkRow({ label: '  ' }))).toBe(true)
    expect(isRowBlank(newLinkRow({ label: 'x' }))).toBe(false)
    expect(isRowBlank(newLinkRow({ url: 'https://x.dev' }))).toBe(false)
  })
})

describe('validateLinkRow', () => {
  it('treats a fully blank row as valid (it will be dropped)', () => {
    expect(validateLinkRow(newLinkRow())).toBeNull()
  })

  it('requires a label when a url is present', () => {
    expect(validateLinkRow(newLinkRow({ url: 'https://x.dev' }))).toMatch(/label/i)
  })

  it('requires a url when a label is present', () => {
    expect(validateLinkRow(newLinkRow({ label: 'Docs' }))).toMatch(/URL/i)
  })

  it('rejects a non-http(s) url', () => {
    expect(validateLinkRow(newLinkRow({ label: 'Docs', url: 'ftp://x.dev' }))).toMatch(/http/i)
    expect(validateLinkRow(newLinkRow({ label: 'Docs', url: 'javascript:alert(1)' }))).toMatch(
      /http/i,
    )
  })

  it('accepts a well-formed http(s) link', () => {
    expect(validateLinkRow(newLinkRow({ label: 'Docs', url: 'https://x.dev' }))).toBeNull()
    expect(validateLinkRow(newLinkRow({ label: 'Docs', url: 'http://x.dev' }))).toBeNull()
  })
})

describe('collectLinkErrors', () => {
  it('returns the first blocking error across rows', () => {
    const rows = [
      newLinkRow({ label: 'Good', url: 'https://good.dev' }),
      newLinkRow({ label: 'Bad' }),
    ]
    expect(collectLinkErrors(rows)).toMatch(/URL/i)
  })

  it('returns null when every row is valid or blank', () => {
    const rows = [newLinkRow({ label: 'Good', url: 'https://good.dev' }), newLinkRow()]
    expect(collectLinkErrors(rows)).toBeNull()
  })
})

describe('rowsToLinks', () => {
  it('drops blank rows, trims, and normalizes to the entity link shape', () => {
    const rows = [
      newLinkRow({ label: '  Docs  ', url: '  https://docs.dev  ', type: 'docs' }),
      newLinkRow(),
    ]
    expect(rowsToLinks(rows)).toEqual([{ label: 'Docs', url: 'https://docs.dev', type: 'docs' }])
  })
})

describe('isSourceLocked', () => {
  it('is false for manual / null / undefined (fully editable)', () => {
    expect(isSourceLocked('manual')).toBe(false)
    expect(isSourceLocked(null)).toBe(false)
    expect(isSourceLocked(undefined)).toBe(false)
  })

  it('is true for any projected source', () => {
    expect(isSourceLocked('apps')).toBe(true)
    expect(isSourceLocked('api-schemas')).toBe(true)
    expect(isSourceLocked('kafka')).toBe(true)
    expect(isSourceLocked('sync')).toBe(true)
  })
})

describe('sourceProvenanceLabel', () => {
  it('is null for manual sources', () => {
    expect(sourceProvenanceLabel('manual')).toBeNull()
    expect(sourceProvenanceLabel(null)).toBeNull()
  })

  it('produces a human "Synced from …" note for projected sources', () => {
    expect(sourceProvenanceLabel('apps')).toBe('Synced from Apps')
    expect(sourceProvenanceLabel('api-schemas')).toBe('Synced from API schemas')
    expect(sourceProvenanceLabel('kafka')).toBe('Synced from Kafka')
  })
})

describe('buildWorkspaceOptions', () => {
  const ws = [
    { id: 'w1', name: 'Payments' },
    { id: 'w2', name: 'Platform' },
  ]

  it('lists workspaces alone when the caller cannot create global entities', () => {
    expect(buildWorkspaceOptions(ws, false)).toEqual([
      { value: 'w1', label: 'Payments' },
      { value: 'w2', label: 'Platform' },
    ])
  })

  it('prepends a Global option for platform admins', () => {
    const opts = buildWorkspaceOptions(ws, true)
    expect(opts[0].value).toBe(GLOBAL_WORKSPACE_VALUE)
    expect(opts[0].label).toMatch(/global/i)
    expect(opts.slice(1).map((o) => o.value)).toEqual(['w1', 'w2'])
  })
})

describe('workspace selection <-> id round-trip', () => {
  it('maps the Global sentinel to null and back', () => {
    expect(workspaceSelectionToId(GLOBAL_WORKSPACE_VALUE)).toBeNull()
    expect(idToWorkspaceSelection(null)).toBe(GLOBAL_WORKSPACE_VALUE)
  })

  it('passes a real workspace id through unchanged', () => {
    expect(workspaceSelectionToId('w1')).toBe('w1')
    expect(idToWorkspaceSelection('w1')).toBe('w1')
  })
})
