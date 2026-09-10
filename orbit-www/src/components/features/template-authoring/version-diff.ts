/**
 * Version diffing — Template Authoring Phase 2, Task 14.
 *
 * A dependency-free line diff over the YAML serialization of two
 * `template-definition-versions.definitionJson` documents, backed by a
 * longest-common-subsequence table (so an inserted line shifts the alignment
 * instead of marking every following line as changed).
 *
 * Deliberately not a word- or character-level diff: the plan scopes version
 * comparison to "basic line diff over `YAML.stringify` of each side, no new
 * diff-library dependency". A changed line surfaces as a `removed` line
 * immediately followed by an `added` line, which is what the panel renders.
 */
import YAML from 'yaml'

export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  /** The line's text (identical on both sides for `context`). */
  text: string
  /** 1-based line number on the left/old side, or null when the line is an addition. */
  left: number | null
  /** 1-based line number on the right/new side, or null when the line is a removal. */
  right: number | null
}

/**
 * Split into lines, ignoring a single trailing newline so that
 * `YAML.stringify` output (which always ends in "\n") does not diff against a
 * hand-typed string as a spurious trailing blank line. An empty string is
 * zero lines, not one blank line.
 */
function toLines(text: string): string[] {
  if (text === '') return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n$/, '')
  return normalized === '' ? [] : normalized.split('\n')
}

/**
 * Longest-common-subsequence line diff. O(n*m) time and memory — fine for
 * template definitions, which are hundreds of lines at most. A guard caps
 * pathological inputs by falling back to "remove everything, add everything".
 */
export function diffLines(leftText: string, rightText: string): DiffLine[] {
  const a = toLines(leftText)
  const b = toLines(rightText)

  const MAX_CELLS = 4_000_000
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text, i): DiffLine => ({ kind: 'removed', text, left: i + 1, right: null })),
      ...b.map((text, i): DiffLine => ({ kind: 'added', text, left: null, right: i + 1 })),
    ]
  }

  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i], left: i + 1, right: j + 1 })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i], left: i + 1, right: null })
      i++
    } else {
      out.push({ kind: 'added', text: b[j], left: null, right: j + 1 })
      j++
    }
  }
  while (i < a.length) {
    out.push({ kind: 'removed', text: a[i], left: i + 1, right: null })
    i++
  }
  while (j < b.length) {
    out.push({ kind: 'added', text: b[j], left: null, right: j + 1 })
    j++
  }
  return out
}

/** Serialize a stored `definitionJson` for diffing. Nullish documents serialize to nothing. */
function stringifyDefinition(definition: unknown): string {
  if (definition === null || definition === undefined) return ''
  try {
    return YAML.stringify(definition)
  } catch {
    return String(definition)
  }
}

/** Line-diff the YAML serializations of two version documents. */
export function diffDefinitions(left: unknown, right: unknown): DiffLine[] {
  return diffLines(stringifyDefinition(left), stringifyDefinition(right))
}

/** Whether a diff contains any non-context line. */
export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.kind !== 'context')
}
