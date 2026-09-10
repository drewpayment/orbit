import { describe, it, expect } from 'vitest'
import { buildFileTree } from './skeleton-file-tree'

describe('buildFileTree', () => {
  it('returns an empty array for no files', () => {
    expect(buildFileTree([])).toEqual([])
  })

  it('builds flat file nodes for top-level files', () => {
    const tree = buildFileTree([{ path: 'b.txt' }, { path: 'a.txt' }])
    expect(tree).toEqual([
      { type: 'file', name: 'a.txt', path: 'a.txt' },
      { type: 'file', name: 'b.txt', path: 'b.txt' },
    ])
  })

  it('nests files under directory segments', () => {
    const tree = buildFileTree([{ path: 'src/index.ts' }, { path: 'README.md' }])
    expect(tree).toEqual([
      {
        type: 'dir',
        name: 'src',
        path: 'src',
        children: [{ type: 'file', name: 'index.ts', path: 'src/index.ts' }],
      },
      { type: 'file', name: 'README.md', path: 'README.md' },
    ])
  })

  it('sorts directories before files at each level, then alphabetically', () => {
    const tree = buildFileTree([
      { path: 'z.txt' },
      { path: 'a/nested.txt' },
      { path: 'm.txt' },
      { path: 'b/nested.txt' },
    ])
    expect(tree.map((n) => n.name)).toEqual(['a', 'b', 'm.txt', 'z.txt'])
    expect(tree.map((n) => n.type)).toEqual(['dir', 'dir', 'file', 'file'])
  })

  it('groups multiple files under the same nested directory chain', () => {
    const tree = buildFileTree([
      { path: 'src/lib/a.ts' },
      { path: 'src/lib/b.ts' },
      { path: 'src/index.ts' },
    ])
    expect(tree).toHaveLength(1)
    const src = tree[0]
    if (src.type !== 'dir') throw new Error('expected dir')
    expect(src.name).toBe('src')
    expect(src.children.map((c) => c.name)).toEqual(['lib', 'index.ts'])
    const lib = src.children[0]
    if (lib.type !== 'dir') throw new Error('expected dir')
    expect(lib.children.map((c) => c.name)).toEqual(['a.ts', 'b.ts'])
    expect(lib.path).toBe('src/lib')
    expect(lib.children[0].path).toBe('src/lib/a.ts')
  })

  it('ignores empty or malformed paths rather than throwing', () => {
    expect(() => buildFileTree([{ path: '' }])).not.toThrow()
    expect(buildFileTree([{ path: '' }])).toEqual([])
  })
})
