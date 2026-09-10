/**
 * Reads the file-level entries out of a dry run's `plan` — Template Authoring
 * Phase 2, Task 14 (`FileTreeDiff`).
 *
 * The Go side's `PlannedChange` shape is not yet pinned down in the proto
 * (`template.proto` carries step progress and outputs, not the plan), and
 * `action-runs.plan` is a free-form JSON field. So this parser is deliberately
 * tolerant: it accepts a bare array or a wrapper object, reads the path and
 * operation from the several spellings the worker might plausibly emit, and
 * treats an unrecognised operation as `changed` rather than silently dropping
 * a file from the author's preview. Anything it cannot read a path from is
 * skipped.
 *
 * `parsePlanFileEntries` returns only `kind: "file"` entries;
 * {@link parsePlanEntries} additionally returns every OTHER kind so the
 * preview can list them generically. That split matters: the Go planner emits
 * `skipped` (a step whose `if` evaluated false) and `unsupported` (a step with
 * no `Plan()` implementation) alongside the substantive kinds, and it may add
 * more. An unrecognised kind is surfaced, never dropped — a preview that
 * quietly omits part of a template reads as complete when it is not.
 */

export type FileChangeKind = 'added' | 'changed' | 'removed'

export interface PlanFileEntry {
  /** Repo-relative path, normalised without a leading `/` or `./`. */
  path: string
  change: FileChangeKind
  /** Optional human-readable note from the planner, e.g. a size or reason. */
  detail: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Pull the array of planned changes out of whichever wrapper the run used. */
function planArray(plan: unknown): unknown[] {
  if (Array.isArray(plan)) return plan
  if (!isRecord(plan)) return []
  for (const key of ['changes', 'files', 'plannedChanges', 'entries']) {
    const candidate = plan[key]
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

const ADDED = new Set(['create', 'created', 'add', 'added', 'new'])
const REMOVED = new Set(['delete', 'deleted', 'remove', 'removed'])

function toChangeKind(op: string | null): FileChangeKind {
  if (!op) return 'changed'
  const normalized = op.trim().toLowerCase()
  if (ADDED.has(normalized)) return 'added'
  if (REMOVED.has(normalized)) return 'removed'
  // update/modify/modified/change/changed and anything unrecognised: show it
  // as a change rather than hiding it from the author.
  return 'changed'
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '')
}

/** Extract the file-level planned changes from a run's `plan` field. */
export function parsePlanFileEntries(plan: unknown): PlanFileEntry[] {
  const out: PlanFileEntry[] = []
  for (const raw of planArray(plan)) {
    if (!isRecord(raw)) continue

    const kind = firstString(raw, ['kind', 'type'])
    if (kind !== null && kind.toLowerCase() !== 'file') continue

    const rawPath = firstString(raw, ['path', 'file', 'target', 'filename'])
    if (!rawPath) continue
    const path = normalizePath(rawPath)
    if (path === '') continue

    out.push({
      path,
      change: toChangeKind(firstString(raw, ['op', 'operation', 'change', 'action', 'status'])),
      detail: firstString(raw, ['detail', 'summary', 'note', 'description']),
    })
  }
  return out
}

export interface FileTreeNode {
  name: string
  /** Full path from the tree root (a directory path has no trailing slash). */
  path: string
  type: 'file' | 'directory'
  /** Set only on file nodes. */
  change?: FileChangeKind
  detail?: string | null
  children: FileTreeNode[]
}

/**
 * Group flat file entries into a nested tree. Directories sort before files,
 * each group alphabetically, so the rendering is stable across polls even
 * though the planner's ordering is not guaranteed.
 */
export function buildFileTree(entries: PlanFileEntry[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', type: 'directory', children: [] }

  for (const entry of entries) {
    const parts = entry.path.split('/').filter((p) => p !== '')
    if (parts.length === 0) continue

    let cursor = root
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      let next = cursor.children.find((c) => c.name === part && (isLeaf ? c.type === 'file' : c.type === 'directory'))
      if (!next) {
        next = {
          name: part,
          path,
          type: isLeaf ? 'file' : 'directory',
          children: [],
          ...(isLeaf ? { change: entry.change, detail: entry.detail } : {}),
        }
        cursor.children.push(next)
      } else if (isLeaf) {
        next.change = entry.change
        next.detail = entry.detail
      }
      cursor = next
    })
  }

  const sortRecursive = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortRecursive(n.children))
    return nodes
  }

  return sortRecursive(root.children)
}

/** Counts per change kind, for the panel's summary line. */
export function summarizeFileEntries(entries: PlanFileEntry[]): Record<FileChangeKind, number> {
  return entries.reduce(
    (acc, e) => {
      acc[e.change] += 1
      return acc
    },
    { added: 0, changed: 0, removed: 0 } as Record<FileChangeKind, number>,
  )
}


/** A planned change that is not a file — a repo, an entity, a skipped step, anything. */
export interface PlanOtherEntry {
  /** The planner's kind, lower-cased. Not restricted to a known set. */
  kind: string
  /** Best-effort label: the entry's name, step, target or id, falling back to the kind. */
  name: string
  /** The planner's own explanation, when it gave one (e.g. why a step was skipped). */
  description: string | null
  /**
   * True for kinds that mean "this part of the template was NOT previewed" —
   * `skipped` and `unsupported`. Drives the incomplete-preview warning.
   */
  incomplete: boolean
}

/**
 * Kinds that represent an absence of preview rather than a planned change.
 * `skipped`: the step's `if` evaluated false, so it never ran.
 * `unsupported`: the action has no `Plan()` implementation to preview with.
 */
export const INCOMPLETE_PLAN_KINDS: readonly string[] = ['skipped', 'unsupported'] as const

/** Split a run's `plan` into file changes and every other kind of planned change. */
export function parsePlanEntries(plan: unknown): {
  files: PlanFileEntry[]
  others: PlanOtherEntry[]
} {
  const files: PlanFileEntry[] = []
  const others: PlanOtherEntry[] = []

  for (const raw of planArray(plan)) {
    if (!isRecord(raw)) continue

    const rawKind = firstString(raw, ['kind', 'type'])
    if (rawKind === null) continue
    const kind = rawKind.trim().toLowerCase()

    if (kind === 'file') {
      const fileEntry = parsePlanFileEntries([raw])[0]
      if (fileEntry) files.push(fileEntry)
      continue
    }

    others.push({
      kind,
      name: firstString(raw, ['name', 'step', 'target', 'path', 'id']) ?? kind,
      description: firstString(raw, ['description', 'reason', 'detail', 'summary', 'note']),
      incomplete: INCOMPLETE_PLAN_KINDS.includes(kind),
    })
  }

  return { files, others }
}

/** Whether any part of the template went un-previewed, making the plan partial. */
export function hasIncompletePreview(others: PlanOtherEntry[]): boolean {
  return others.some((o) => o.incomplete)
}
