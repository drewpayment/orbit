import { describe, expect, it } from 'vitest'
import { diffLines, diffDefinitions, foldUnchanged, type DiffLine } from './version-diff'

function kinds(lines: DiffLine[]): string {
  return lines.map((l) => l.kind[0]).join('')
}

function context(text: string): DiffLine {
  return { kind: 'context', text, left: 1, right: 1 }
}
function added(text: string): DiffLine {
  return { kind: 'added', text, left: null, right: 1 }
}
function removed(text: string): DiffLine {
  return { kind: 'removed', text, left: 1, right: null }
}

describe('foldUnchanged', () => {
  it('leaves a short diff untouched (nothing to fold)', () => {
    const lines = [context('a'), added('b'), context('c')]
    expect(foldUnchanged(lines)).toEqual(lines)
  })

  it('folds a long unchanged run in the middle, keeping context lines around each change', () => {
    const lines: DiffLine[] = [
      added('start'),
      ...Array.from({ length: 20 }, (_, i) => context(`u${i}`)),
      removed('end'),
    ]
    const folded = foldUnchanged(lines, 3)
    // 1 added + 3 leading context + separator + 3 trailing context + 1 removed
    expect(folded).toHaveLength(1 + 3 + 1 + 3 + 1)
    expect(folded[0]).toEqual(added('start'))
    expect(folded.slice(1, 4)).toEqual([context('u0'), context('u1'), context('u2')])
    const sep = folded[4]
    expect(sep.kind).toBe('separator')
    expect(sep.text).toMatch(/14 unchanged lines/)
    expect(folded.slice(5, 8)).toEqual([context('u17'), context('u18'), context('u19')])
    expect(folded[8]).toEqual(removed('end'))
  })

  it('does not fold a run shorter than or equal to 2*context (nothing worth collapsing)', () => {
    const lines: DiffLine[] = [
      added('start'),
      ...Array.from({ length: 6 }, (_, i) => context(`u${i}`)),
      removed('end'),
    ]
    const folded = foldUnchanged(lines, 3)
    expect(folded).toEqual(lines)
  })

  it('folds unchanged lines at the very start and end of the diff', () => {
    const lines: DiffLine[] = [
      ...Array.from({ length: 10 }, (_, i) => context(`u${i}`)),
      added('mid'),
      ...Array.from({ length: 10 }, (_, i) => context(`v${i}`)),
    ]
    const folded = foldUnchanged(lines, 3)
    expect(folded[0].kind).toBe('separator')
    expect(folded[0].text).toMatch(/7 unchanged lines/)
    expect(folded.slice(1, 4)).toEqual([context('u7'), context('u8'), context('u9')])
    expect(folded[4]).toEqual(added('mid'))
    expect(folded.slice(5, 8)).toEqual([context('v0'), context('v1'), context('v2')])
    expect(folded[8].kind).toBe('separator')
    expect(folded[8].text).toMatch(/7 unchanged lines/)
  })

  it('handles an all-context diff by folding the whole thing to one separator', () => {
    const lines = Array.from({ length: 10 }, (_, i) => context(`u${i}`))
    const folded = foldUnchanged(lines, 3)
    expect(folded).toHaveLength(1)
    expect(folded[0].kind).toBe('separator')
    expect(folded[0].text).toMatch(/10 unchanged lines/)
  })
})

describe('diffLines', () => {
  it('reports every line as context when both sides are identical', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')
    expect(kinds(lines)).toBe('ccc')
    expect(lines.every((l) => l.left !== null && l.right !== null)).toBe(true)
  })

  it('marks a pure addition', () => {
    const lines = diffLines('a\nc', 'a\nb\nc')
    expect(kinds(lines)).toBe('cac')
    const added = lines.find((l) => l.kind === 'added')
    expect(added?.text).toBe('b')
    expect(added?.left).toBeNull()
    expect(added?.right).toBe(2)
  })

  it('marks a pure removal', () => {
    const lines = diffLines('a\nb\nc', 'a\nc')
    expect(kinds(lines)).toBe('crc')
    const removed = lines.find((l) => l.kind === 'removed')
    expect(removed?.text).toBe('b')
    expect(removed?.left).toBe(2)
    expect(removed?.right).toBeNull()
  })

  it('represents a changed line as a removal followed by an addition', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc')
    expect(kinds(lines)).toBe('crac')
  })

  it('handles an empty left side', () => {
    const lines = diffLines('', 'a\nb')
    expect(lines.filter((l) => l.kind === 'added').map((l) => l.text)).toEqual(['a', 'b'])
    expect(lines.some((l) => l.kind === 'removed' && l.text !== '')).toBe(false)
  })

  it('handles an empty right side', () => {
    const lines = diffLines('a\nb', '')
    expect(lines.filter((l) => l.kind === 'removed').map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('ignores a trailing newline so a round trip is not reported as a change', () => {
    expect(diffLines('a\nb\n', 'a\nb').every((l) => l.kind === 'context')).toBe(true)
  })

  it('finds the longest common subsequence rather than aligning positionally', () => {
    // Naive positional alignment would call every line changed.
    const lines = diffLines('one\ntwo\nthree', 'zero\none\ntwo\nthree')
    expect(kinds(lines)).toBe('acccc'.slice(0, 4))
    expect(lines[0]).toMatchObject({ kind: 'added', text: 'zero' })
  })
})

describe('diffDefinitions', () => {
  it('serializes both sides to YAML and diffs them', () => {
    const left = { metadata: { title: 'Before' } }
    const right = { metadata: { title: 'After' } }
    const lines = diffDefinitions(left, right)
    expect(lines.some((l) => l.kind === 'removed' && l.text.includes('Before'))).toBe(true)
    expect(lines.some((l) => l.kind === 'added' && l.text.includes('After'))).toBe(true)
  })

  it('reports no changes for structurally identical definitions', () => {
    const doc = { spec: { steps: [{ id: 'a' }] } }
    expect(diffDefinitions(doc, structuredClone(doc)).every((l) => l.kind === 'context')).toBe(true)
  })

  it('treats null/undefined definitionJson as empty rather than throwing', () => {
    expect(() => diffDefinitions(null, undefined)).not.toThrow()
    expect(diffDefinitions(null, { a: 1 }).some((l) => l.kind === 'added')).toBe(true)
  })
})
