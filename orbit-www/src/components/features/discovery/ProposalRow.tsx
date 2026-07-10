'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import type { DiscoveredEntity } from '@/payload-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  ConfidenceChip,
  KindBadge,
  detectionEvidence,
  importedHref,
  ownershipHints,
  parseEvidence,
  proposalSummary,
} from './discovery-ui'

/**
 * A single discovery-proposal row: kind/confidence badges, path, summary,
 * ownership hints, an evidence expander, and optional approve/ignore actions.
 *
 * Shared by the workspace review queue (DiscoveryClient) and the platform-level
 * global queue (GlobalDiscoveryClient, WP8). The `footer` slot lets the global
 * queue inject its per-row approval choice (import as global entity vs. assign to
 * a workspace) without forking the row.
 */
export function ProposalRow({
  row,
  selectable = false,
  selected = false,
  onToggle,
  note,
  pending = false,
  onApprove,
  onIgnore,
  imported = false,
  footer,
}: {
  row: DiscoveredEntity
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
  note?: string
  pending?: boolean
  onApprove?: () => void
  onIgnore?: () => void
  imported?: boolean
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const evidence = parseEvidence(row.evidence)
  const detectors = detectionEvidence(evidence)
  const owners = ownershipHints(evidence)
  const summary = proposalSummary(row)
  const pathLabel = row.path ? row.path : 'repository root'

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {selectable && (
          <Checkbox
            className="mt-1"
            checked={selected}
            onCheckedChange={() => onToggle?.()}
            aria-label={`Select ${pathLabel}`}
          />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={row.detectedKind} />
            <ConfidenceChip confidence={row.confidence} />
            <span className="font-mono text-sm">{pathLabel}</span>
            {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
          </div>

          {owners.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Suggested owners: <span className="text-foreground">{owners.join(', ')}</span>
            </p>
          )}

          {detectors.length > 0 && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                {open ? 'Hide' : 'Show'} evidence ({detectors.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ul className="space-y-1">
                  {detectors.map((e, i) => (
                    <li key={`${e.detector}-${e.file ?? i}`} className="text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        {e.detector}
                      </span>{' '}
                      {e.file && <span className="font-mono">{e.file}</span>}
                      {e.excerpt && <span className="italic"> — {e.excerpt}</span>}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}

          {note && <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p>}

          {imported && row.importedRef?.collectionSlug && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                Imported into <span className="font-mono">{row.importedRef.collectionSlug}</span>
              </span>
              {importedHref(row.importedRef.collectionSlug, row.importedRef.docId) && (
                <Link
                  href={importedHref(row.importedRef.collectionSlug, row.importedRef.docId) as string}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  View <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </p>
          )}

          {footer}
        </div>

        {(onApprove || onIgnore) && (
          <div className="flex shrink-0 items-center gap-2">
            {onApprove && (
              <Button size="sm" variant="outline" disabled={pending} onClick={onApprove}>
                <Check className="mr-1 h-4 w-4" /> Approve
              </Button>
            )}
            {onIgnore && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={onIgnore}
                aria-label="Ignore proposal"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
