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
 * Only `kind: "file"` entries are returned; other planned changes (repos,
 * catalog entities, topics) are summarised elsewhere in the dry-run panel.
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
