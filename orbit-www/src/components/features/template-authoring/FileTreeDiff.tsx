/**
 * File-tree diff viewer — Template Authoring Phase 2, Task 14.
 *
 * Renders a dry run's plan: the `kind: "file"` entries as an added / changed
 * / removed tree, plus every other kind as a generic kind/name/description
 * row. Deliberately shallow for v1: no line-level diff (the plan notes
 * Monaco's diff editor as a contained follow-up if authors ask for one), just
 * the shape of what the template would do.
 *
 * The generic row is the important part. The planner emits `skipped` (a step
 * whose `if` was false) and `unsupported` (a step with no `Plan()` to preview
 * with) beside substantive kinds like `repo` and `entity`, and may add more.
 * Unknown kinds render rather than vanish, and the two "not previewed" kinds
 * are styled apart and summarised in a legend — otherwise a partial preview
 * looks like a complete one, which is exactly the mistake the publish gate
 * exists to prevent.
 *
 * Kinds, names and paths come from the worker's plan. They are rendered as
 * React text, never as HTML.
 */
'use client'

import * as React from 'react'
import { CircleSlash, FileDiff, FileMinus, FilePlus, Folder, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  buildFileTree,
  hasIncompletePreview,
  summarizeFileEntries,
  type FileChangeKind,
  type FileTreeNode,
  type PlanFileEntry,
  type PlanOtherEntry,
} from './plan-entries'

export interface FileTreeDiffProps {
  entries: PlanFileEntry[]
  /** Every non-file planned change, rendered generically below the tree. */
  others?: PlanOtherEntry[]
}

const CHANGE_STYLE: Record<FileChangeKind, { icon: typeof FilePlus; className: string; label: string }> = {
  added: { icon: FilePlus, className: 'text-emerald-600 dark:text-emerald-400', label: 'added' },
  changed: { icon: FileDiff, className: 'text-amber-600 dark:text-amber-400', label: 'changed' },
  removed: { icon: FileMinus, className: 'text-destructive', label: 'removed' },
}

function TreeNode({ node, depth }: { node: FileTreeNode; depth: number }) {
  if (node.type === 'directory') {
    return (
      <li>
        <div
          className="flex items-center gap-1.5 py-0.5 text-sm text-muted-foreground"
          style={{ paddingLeft: depth * 14 }}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">{node.name}</span>
        </div>
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      </li>
    )
  }

  const style = CHANGE_STYLE[node.change ?? 'changed']
  const Icon = style.icon
  return (
    <li>
      <div
        className="flex items-center gap-1.5 py-0.5 text-sm"
        style={{ paddingLeft: depth * 14 }}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', style.className)} />
        <span className="font-mono">{node.name}</span>
        <span className="sr-only">{style.label}</span>
        {node.detail ? (
          <span className="truncate text-xs text-muted-foreground">{node.detail}</span>
        ) : null}
      </div>
    </li>
  )
}

/** One non-file planned change: a kind badge, a name, and the planner's note. */
function OtherEntryRow({ entry }: { entry: PlanOtherEntry }) {
  return (
    <li
      data-incomplete={entry.incomplete ? 'true' : 'false'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-1.5 text-sm',
        entry.incomplete && 'border-dashed bg-muted/30 text-muted-foreground',
      )}
    >
      {entry.incomplete ? <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
      <Badge variant={entry.incomplete ? 'outline' : 'secondary'} className="shrink-0">
        {entry.kind}
      </Badge>
      <span className="min-w-0 flex-1">
        <span className="break-all font-mono text-xs">{entry.name}</span>
        {entry.description ? (
          <span className="block text-xs text-muted-foreground">{entry.description}</span>
        ) : null}
      </span>
    </li>
  )
}

export function FileTreeDiff({ entries, others = [] }: FileTreeDiffProps) {
  const tree = React.useMemo(() => buildFileTree(entries), [entries])
  const counts = React.useMemo(() => summarizeFileEntries(entries), [entries])
  const incomplete = hasIncompletePreview(others)

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          This plan writes no files.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">{counts.added} added</span>
            {' · '}
            <span className="text-amber-600 dark:text-amber-400">{counts.changed} changed</span>
            {' · '}
            <span className="text-destructive">{counts.removed} removed</span>
          </p>
          <ul className="max-h-80 overflow-auto rounded-md border p-2">
            {tree.map((node) => (
              <TreeNode key={node.path} node={node} depth={0} />
            ))}
          </ul>
        </div>
      )}

      {others.length > 0 ? (
        <ul className="space-y-1">
          {others.map((entry, i) => (
            <OtherEntryRow key={`${entry.kind}:${entry.name}:${i}`} entry={entry} />
          ))}
        </ul>
      ) : null}

      {incomplete ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This is not the whole picture: steps marked <strong>skipped</strong> did not run, and{' '}
            <strong>unsupported</strong> steps could not be previewed. They will still execute on a
            real run.
          </span>
        </p>
      ) : null}
    </div>
  )
}
