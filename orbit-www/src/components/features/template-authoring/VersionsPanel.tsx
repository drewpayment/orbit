/**
 * Versions panel — Template Authoring Phase 2, Task 14.
 *
 * Lists the definition's immutable version snapshots and line-diffs any two
 * of them (`version-diff.ts`). Every save creates a version, so this doubles
 * as the authoring audit trail: which snapshot is current, which passed
 * validation, and which has a recorded dry run — the two facts the publish
 * gate turns on.
 *
 * The version list renders as a compact, scrollable stack (one line per
 * version) so eight-plus versions don't dominate the page, and the compare
 * diff sits behind a collapsed-by-default trigger — most visits to this
 * panel are "what's here", not "diff two versions".
 */
'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { diffDefinitions, foldUnchanged, hasChanges } from './version-diff'

export interface VersionRow {
  id: string
  versionNumber: number
  changeNote: string | null
  validatedAt: string | null
  dryRunRunId: string | null
  createdAt: string
  isCurrent: boolean
  definitionJson: unknown
}

export interface VersionsPanelProps {
  versions: VersionRow[]
}

/** Newest against the one before it — the comparison an author almost always wants. */
function defaultSelection(versions: VersionRow[]): { left: string; right: string } {
  return {
    left: versions[1]?.id ?? versions[0]?.id ?? '',
    right: versions[0]?.id ?? '',
  }
}

export function VersionsPanel({ versions }: VersionsPanelProps) {
  // Saving a draft adds a version and re-renders this panel with a longer
  // list. A plain `useState` initializer would not re-run, leaving both
  // selectors pinned to whatever existed at mount — after the very first save
  // that means "v1 to v1" and a permanent "pick two different versions".
  // Reset the selection during render (the supported React pattern) whenever
  // the set of versions changes.
  const versionsKey = versions.map((v) => v.id).join(',')
  const [selection, setSelection] = React.useState(() => ({
    ...defaultSelection(versions),
    key: versionsKey,
  }))
  if (selection.key !== versionsKey) {
    setSelection({ ...defaultSelection(versions), key: versionsKey })
  }

  const [compareOpen, setCompareOpen] = React.useState(false)

  const leftId = selection.left
  const rightId = selection.right
  const setLeftId = (id: string) => setSelection((s) => ({ ...s, left: id }))
  const setRightId = (id: string) => setSelection((s) => ({ ...s, right: id }))

  const byId = React.useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions])
  const rawDiff = React.useMemo(() => {
    const left = byId.get(leftId)
    const right = byId.get(rightId)
    if (!left || !right || left.id === right.id) return null
    return diffDefinitions(left.definitionJson, right.definitionJson)
  }, [byId, leftId, rightId])
  const diff = React.useMemo(() => (rawDiff ? foldUnchanged(rawDiff) : null), [rawDiff])

  if (versions.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        No versions yet.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Versions</h3>

      <ul className="max-h-56 space-y-1 overflow-auto pr-1">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-medium">v{v.versionNumber}</span>
              {v.changeNote ? (
                <span className="truncate text-xs text-muted-foreground">{v.changeNote}</span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {v.isCurrent ? <Badge variant="default">Current</Badge> : null}
              {v.validatedAt ? <Badge variant="secondary">Validated</Badge> : null}
              {v.dryRunRunId ? <Badge variant="secondary">Dry run</Badge> : null}
            </span>
          </li>
        ))}
      </ul>

      {versions.length > 1 ? (
        <Collapsible open={compareOpen} onOpenChange={setCompareOpen} className="space-y-2 border-t pt-3">
          <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', compareOpen && 'rotate-90')} />
            Compare versions
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Select value={leftId} onValueChange={setLeftId}>
                <SelectTrigger aria-label="Compare from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      v{v.versionNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">to</span>
              <Select value={rightId} onValueChange={setRightId}>
                <SelectTrigger aria-label="Compare to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      v{v.versionNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rawDiff === null ? (
              <p className="text-sm text-muted-foreground">Pick two different versions.</p>
            ) : !hasChanges(rawDiff) ? (
              <p className="text-sm text-muted-foreground">These versions are identical.</p>
            ) : (
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">
                {(diff ?? []).map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'whitespace-pre-wrap font-mono',
                      line.kind === 'added' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                      line.kind === 'removed' && 'bg-destructive/10 text-destructive',
                      line.kind === 'context' && 'text-muted-foreground',
                      line.kind === 'separator' && 'text-muted-foreground/70',
                    )}
                  >
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                    {line.text}
                  </div>
                ))}
              </pre>
            )}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
