import { describe, expect, it } from 'vitest'
import {
  buildFileTree,
  hasIncompletePreview,
  parsePlanEntries,
  parsePlanFileEntries,
} from './plan-entries'

describe('parsePlanFileEntries', () => {
  it('returns nothing for an absent or non-plan value', () => {
    expect(parsePlanFileEntries(null)).toEqual([])
    expect(parsePlanFileEntries(undefined)).toEqual([])
    expect(parsePlanFileEntries('not a plan')).toEqual([])
    expect(parsePlanFileEntries(42)).toEqual([])
  })

  it('reads a bare array of planned changes', () => {
    const entries = parsePlanFileEntries([
      { kind: 'file', path: 'src/main.go', op: 'create' },
      { kind: 'file', path: 'README.md', op: 'update' },
    ])
    expect(entries).toEqual([
      { path: 'src/main.go', change: 'added', detail: null },
      { path: 'README.md', change: 'changed', detail: null },
    ])
  })

  it('unwraps a plan object that wraps its changes', () => {
    expect(parsePlanFileEntries({ changes: [{ kind: 'file', path: 'a.txt', op: 'delete' }] })).toEqual([
      { path: 'a.txt', change: 'removed', detail: null },
    ])
    expect(parsePlanFileEntries({ files: [{ kind: 'file', path: 'b.txt', op: 'create' }] })).toEqual([
      { path: 'b.txt', change: 'added', detail: null },
    ])
  })

  it('ignores planned changes that are not files', () => {
    const entries = parsePlanFileEntries([
      { kind: 'repo', path: 'org/repo', op: 'create' },
      { kind: 'file', path: 'go.mod', op: 'create' },
    ])
    expect(entries.map((e) => e.path)).toEqual(['go.mod'])
  })

  it('accepts the several spellings the Go side may emit for the operation', () => {
    const changes = (op: string) => parsePlanFileEntries([{ kind: 'file', path: 'f', op }])[0].change
    expect(changes('create')).toBe('added')
    expect(changes('created')).toBe('added')
    expect(changes('add')).toBe('added')
    expect(changes('ADDED')).toBe('added')
    expect(changes('update')).toBe('changed')
    expect(changes('modified')).toBe('changed')
    expect(changes('delete')).toBe('removed')
    expect(changes('remove')).toBe('removed')
  })

  it('reads the operation and path from alternate key spellings', () => {
    expect(parsePlanFileEntries([{ kind: 'file', file: 'x.ts', action: 'removed' }])).toEqual([
      { path: 'x.ts', change: 'removed', detail: null },
    ])
    expect(parsePlanFileEntries([{ kind: 'file', target: 'y.ts', change: 'added' }])).toEqual([
      { path: 'y.ts', change: 'added', detail: null },
    ])
  })

  it('defaults an unrecognised operation to changed rather than dropping the file', () => {
    expect(parsePlanFileEntries([{ kind: 'file', path: 'z', op: 'wat' }])[0].change).toBe('changed')
    expect(parsePlanFileEntries([{ kind: 'file', path: 'z' }])[0].change).toBe('changed')
  })

  it('skips entries with no usable path', () => {
    expect(parsePlanFileEntries([{ kind: 'file', op: 'create' }, { kind: 'file', path: '' }])).toEqual([])
  })

  it('carries a human-readable detail when one is present', () => {
    expect(parsePlanFileEntries([{ kind: 'file', path: 'a', op: 'create', detail: '12 lines' }])[0].detail).toBe(
      '12 lines',
    )
  })

  it('normalises leading slashes and ./ so tree grouping is stable', () => {
    expect(parsePlanFileEntries([{ kind: 'file', path: './src/a.ts', op: 'create' }])[0].path).toBe('src/a.ts')
    expect(parsePlanFileEntries([{ kind: 'file', path: '/src/b.ts', op: 'create' }])[0].path).toBe('src/b.ts')
  })
})

describe('buildFileTree', () => {
  it('groups files into nested directory nodes', () => {
    const tree = buildFileTree([
      { path: 'src/app/main.go', change: 'added', detail: null },
      { path: 'src/app/util.go', change: 'changed', detail: null },
      { path: 'README.md', change: 'added', detail: null },
    ])
    // Directories sort before files, each alphabetically.
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md'])
    const src = tree[0]
    expect(src.type).toBe('directory')
    expect(src.children.map((n) => n.name)).toEqual(['app'])
    expect(src.children[0].children.map((n) => n.name)).toEqual(['main.go', 'util.go'])
    expect(src.children[0].children[0]).toMatchObject({ type: 'file', change: 'added' })
  })

  it('returns an empty tree for no entries', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('handles a single root-level file', () => {
    const tree = buildFileTree([{ path: 'go.mod', change: 'removed', detail: null }])
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ name: 'go.mod', type: 'file', change: 'removed' })
  })
})

describe('parsePlanEntries', () => {
  it('splits file entries from every other kind', () => {
    const { files, others } = parsePlanEntries([
      { kind: 'file', path: 'src/main.go', op: 'create' },
      { kind: 'repo', name: 'org/svc', op: 'create' },
      { kind: 'entity', name: 'svc', description: 'Catalog entity' },
    ])
    expect(files.map((f) => f.path)).toEqual(['src/main.go'])
    expect(others.map((o) => o.kind)).toEqual(['repo', 'entity'])
  })

  it('returns empty lists for a non-plan value', () => {
    expect(parsePlanEntries(null)).toEqual({ files: [], others: [] })
    expect(parsePlanEntries('nope')).toEqual({ files: [], others: [] })
  })

  it('reads a skipped step, which means the step never ran', () => {
    const { others } = parsePlanEntries([
      { kind: 'skipped', step: 'create-repo', reason: 'if evaluated false' },
    ])
    expect(others).toEqual([
      {
        kind: 'skipped',
        name: 'create-repo',
        description: 'if evaluated false',
        incomplete: true,
      },
    ])
  })

  it('reads an unsupported entry, which means the step could not be previewed', () => {
    const { others } = parsePlanEntries([
      { kind: 'unsupported', name: 'kafka:topic:create', detail: 'no Plan() implementation' },
    ])
    expect(others[0]).toMatchObject({ kind: 'unsupported', incomplete: true })
  })

  it('marks only skipped and unsupported as incomplete', () => {
    const { others } = parsePlanEntries([
      { kind: 'repo', name: 'a' },
      { kind: 'skipped', name: 'b' },
      { kind: 'unsupported', name: 'c' },
      { kind: 'entity', name: 'd' },
    ])
    expect(others.map((o) => o.incomplete)).toEqual([false, true, true, false])
  })

  it('keeps an unknown future kind rather than dropping it', () => {
    // The Go side may add kinds; the preview must never silently omit one.
    const { others } = parsePlanEntries([{ kind: 'dns-record', name: 'svc.example.com' }])
    expect(others).toEqual([
      { kind: 'dns-record', name: 'svc.example.com', description: null, incomplete: false },
    ])
  })

  it('falls back through the name-ish keys, and to the kind itself', () => {
    const name = (raw: Record<string, unknown>) => parsePlanEntries([raw]).others[0].name
    expect(name({ kind: 'repo', name: 'by-name' })).toBe('by-name')
    expect(name({ kind: 'repo', step: 'by-step' })).toBe('by-step')
    expect(name({ kind: 'repo', target: 'by-target' })).toBe('by-target')
    expect(name({ kind: 'repo', id: 'by-id' })).toBe('by-id')
    expect(name({ kind: 'repo' })).toBe('repo')
  })

  it('normalises the kind to lower case', () => {
    expect(parsePlanEntries([{ kind: 'SKIPPED', name: 'x' }]).others[0]).toMatchObject({
      kind: 'skipped',
      incomplete: true,
    })
  })

  it('skips an entry with no readable kind at all', () => {
    expect(parsePlanEntries([{ name: 'no kind' }, 'string', 42]).others).toEqual([])
  })
})

describe('hasIncompletePreview', () => {
  it('is true when anything was skipped or could not be previewed', () => {
    expect(hasIncompletePreview([{ kind: 'skipped', name: 'a', description: null, incomplete: true }])).toBe(true)
  })

  it('is false for a fully-previewed plan', () => {
    expect(hasIncompletePreview([{ kind: 'repo', name: 'a', description: null, incomplete: false }])).toBe(false)
    expect(hasIncompletePreview([])).toBe(false)
  })
})
