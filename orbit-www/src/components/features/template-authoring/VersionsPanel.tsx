/**
 * Versions panel — Template Authoring Phase 2, Task 14.
 *
 * Lists the definition's immutable version snapshots and line-diffs any two
 * of them (`version-diff.ts`). Every save creates a version, so this doubles
 * as the authoring audit trail: which snapshot is current, which passed
 * validation, and which has a recorded dry run — the two facts the publish
 * gate turns on.
 */
'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { diffDefinitions, hasChanges } from './version-diff'

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

export function VersionsPanel({ versions }: VersionsPanelProps) {
  // Default to comparing the newest against the one before it.
  const [leftId, setLeftId] = React.useState<string>(() => versions[1]?.id ?? versions[0]?.id ?? '')
  const [rightId, setRightId] = React.useState<string>(() => versions[0]?.id ?? '')

  const byId = React.useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions])
  const diff = React.useMemo(() => {
    const left = byId.get(leftId)
    const right = byId.get(rightId)
    if (!left || !right || left.id === right.id) return null
    return diffDefinitions(left.definitionJson, right.definitionJson)
  }, [byId, leftId, rightId])

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

      <ul className="space-y-1.5">
        {versions.map((v) => (
          <li key={v.id} className="rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">v{v.versionNumber}</span>
              <span className="flex items-center gap-1">
                {v.isCurrent ? <Badge variant="default">Current</Badge> : null}
                {v.validatedAt ? <Badge variant="secondary">Validated</Badge> : null}
                {v.dryRunRunId ? <Badge variant="secondary">Dry run</Badge> : null}
              </span>
            </div>
            {v.changeNote ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.changeNote}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {versions.length > 1 ? (
        <div className="space-y-2 border-t pt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Compare
          </h4>
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

          {diff === null ? (
            <p className="text-sm text-muted-foreground">Pick two different versions.</p>
          ) : !hasChanges(diff) ? (
            <p className="text-sm text-muted-foreground">These versions are identical.</p>
          ) : (
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">
              {diff.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap font-mono',
                    line.kind === 'added' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    line.kind === 'removed' && 'bg-destructive/10 text-destructive',
                    line.kind === 'context' && 'text-muted-foreground',
                  )}
                >
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                  {line.text}
                </div>
              ))}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  )
}
