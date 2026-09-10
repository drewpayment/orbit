import { describe, expect, it } from 'vitest'
import { diffLines, diffDefinitions, type DiffLine } from './version-diff'

function kinds(lines: DiffLine[]): string {
  return lines.map((l) => l.kind[0]).join('')
}

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
