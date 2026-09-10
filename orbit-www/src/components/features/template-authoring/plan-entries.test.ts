import { describe, expect, it } from 'vitest'
import { buildFileTree, parsePlanFileEntries } from './plan-entries'

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
