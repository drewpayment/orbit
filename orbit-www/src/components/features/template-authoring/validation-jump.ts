/**
 * Maps a validation error's `path` onto a place in the editor — Template
 * Authoring Phase 2, Task 14 ("jump-to-field links, best-effort: match by
 * field path, fall back to a flat list").
 *
 * Best-effort by design: the validator's paths come from two sources (Zod
 * issue paths and the cross-referential checks in `lib/scaffolder/validate.ts`),
 * so this recognises the shapes it can place and returns `null` for anything
 * else rather than guessing. The panel renders an unlinked row for a `null`.
 */

export type EditorTab = 'metadata' | 'parameters' | 'steps' | 'output'

export interface JumpTarget {
  tab: EditorTab
  /** Parameter page index, when the path named one. */
  pageIndex?: number
  /** Step index, when the path named one. */
  stepIndex?: number
  /** Short human label for the link text. */
  label: string
}

/** Split `a.b[0].c` and `a.b.0.c` into the same segment list. */
function segments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s !== '')
}

function asIndex(segment: string | undefined): number | undefined {
  if (segment === undefined) return undefined
  if (!/^\d+$/.test(segment)) return undefined
  return Number(segment)
}

/** Resolve a validation error path to an editor location, or null when unplaceable. */
export function parseJumpTarget(path: string | undefined | null): JumpTarget | null {
  if (!path) return null
  const parts = segments(path)
  if (parts.length === 0) return null

  if (parts[0] === 'metadata') {
    return { tab: 'metadata', label: 'Metadata' }
  }

  if (parts[0] !== 'spec') return null

  switch (parts[1]) {
    case 'parameters': {
      const pageIndex = asIndex(parts[2])
      if (pageIndex === undefined) return { tab: 'parameters', label: 'Parameters' }
      return { tab: 'parameters', pageIndex, label: `Parameters, page ${pageIndex + 1}` }
    }
    case 'steps': {
      const stepIndex = asIndex(parts[2])
      if (stepIndex === undefined) return { tab: 'steps', label: 'Steps' }
      return { tab: 'steps', stepIndex, label: `Steps, step ${stepIndex + 1}` }
    }
    case 'output':
      return { tab: 'output', label: 'Output' }
    default:
      return null
  }
}
