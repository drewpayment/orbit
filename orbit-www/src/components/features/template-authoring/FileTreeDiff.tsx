/**
 * File-tree diff viewer — Template Authoring Phase 2, Task 14.
 *
 * Renders the `kind: "file"` entries of a dry run's plan as an added /
 * changed / removed tree. Deliberately shallow for v1: no line-level diff
 * (the plan notes Monaco's diff editor as a contained follow-up if authors
 * ask for one), just the shape of what the template would write.
 *
 * Paths come from the run plan, which originates on the worker. They are
 * rendered as React text, never as HTML.
 */
'use client'

import * as React from 'react'
import { FileDiff, FileMinus, FilePlus, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  buildFileTree,
  summarizeFileEntries,
  type FileChangeKind,
  type FileTreeNode,
  type PlanFileEntry,
} from './plan-entries'

export interface FileTreeDiffProps {
  entries: PlanFileEntry[]
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

export function FileTreeDiff({ entries }: FileTreeDiffProps) {
  const tree = React.useMemo(() => buildFileTree(entries), [entries])
  const counts = React.useMemo(() => summarizeFileEntries(entries), [entries])

  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        This plan writes no files.
      </p>
    )
  }

  return (
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
  )
}
