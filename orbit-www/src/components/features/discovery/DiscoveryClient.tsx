'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import type { DiscoveredEntity } from '@/payload-types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  startWorkspaceScan,
  approveDiscoveries,
  ignoreDiscoveries,
  getScanStatus,
  type ScanStatusEntry,
} from '@/app/actions/discovery'
import {
  ConfidenceChip,
  KindBadge,
  detectionEvidence,
  groupByRepo,
  humanizeSkippedReason,
  ownershipHints,
  parseEvidence,
  proposalSummary,
} from './discovery-ui'

interface DiscoveryClientProps {
  workspaceId: string
  workspaceSlug: string
  discoveries: DiscoveredEntity[]
  scanStatuses: ScanStatusEntry[]
}

type Tab = 'proposed' | 'ignored' | 'imported'

const SCAN_POLL_MS = 5000

export function DiscoveryClient({
  workspaceId,
  discoveries,
  scanStatuses,
}: DiscoveryClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('proposed')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<Map<string, string>>(new Map())
  const [statuses, setStatuses] = useState<ScanStatusEntry[]>(scanStatuses)

  // Re-sync from the server whenever a refresh delivers new props.
  useEffect(() => setStatuses(scanStatuses), [scanStatuses])

  const proposed = useMemo(() => discoveries.filter((d) => d.status === 'proposed'), [discoveries])
  const ignored = useMemo(() => discoveries.filter((d) => d.status === 'ignored'), [discoveries])
  const imported = useMemo(() => discoveries.filter((d) => d.status === 'imported'), [discoveries])

  const scanning = statuses.some((s) => s.status === 'running')

  // While a scan is running, poll status and pull in newly-staged proposals.
  useEffect(() => {
    if (!scanning) return
    const timer = setInterval(async () => {
      const res = await getScanStatus(workspaceId)
      if (res.success) setStatuses(res.statuses)
      router.refresh()
    }, SCAN_POLL_MS)
    return () => clearInterval(timer)
  }, [scanning, workspaceId, router])

  const setNote = useCallback((id: string, note: string) => {
    setNotes((prev) => {
      const next = new Map(prev)
      next.set(id, note)
      return next
    })
  }, [])

  const clearNote = useCallback((id: string) => {
    setNotes((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (ids: string[], checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of ids) {
          if (checked) next.add(id)
          else next.delete(id)
        }
        return next
      })
    },
    [],
  )

  const onScan = useCallback(() => {
    startTransition(async () => {
      const res = await startWorkspaceScan(workspaceId)
      if (!res.success) {
        toast.error(res.error ?? 'Failed to start scan')
        return
      }
      toast.success(
        res.started.length === 1
          ? 'Scan started — proposals will appear as repositories are scanned.'
          : `Scan started for ${res.started.length} installations.`,
      )
      const status = await getScanStatus(workspaceId)
      if (status.success) setStatuses(status.statuses)
      router.refresh()
    })
  }, [workspaceId, router])

  const onApprove = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      startTransition(async () => {
        const res = await approveDiscoveries(ids)
        if (!res.success) {
          toast.error(res.error ?? 'Failed to approve proposals')
          return
        }
        let importedCount = 0
        for (const r of res.results) {
          if (r.imported) {
            importedCount++
            clearNote(r.id)
          } else {
            setNote(r.id, humanizeSkippedReason(r.skippedReason))
          }
        }
        const skipped = res.results.length - importedCount
        if (importedCount > 0) {
          toast.success(`Imported ${importedCount} ${importedCount === 1 ? 'entity' : 'entities'}.`)
        }
        if (skipped > 0) {
          toast.warning(`${skipped} proposal${skipped === 1 ? '' : 's'} could not be imported.`)
        }
        setSelected(new Set())
        router.refresh()
      })
    },
    [router, clearNote, setNote],
  )

  const onIgnore = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      startTransition(async () => {
        const res = await ignoreDiscoveries(ids)
        if (!res.success) {
          toast.error(res.error ?? 'Failed to ignore proposals')
          return
        }
        const ignoredCount = res.results.filter((r) => r.ignored).length
        if (ignoredCount > 0) {
          toast.success(`Ignored ${ignoredCount} proposal${ignoredCount === 1 ? '' : 's'}.`)
        }
        setSelected(new Set())
        router.refresh()
      })
    },
    [router],
  )

  const proposedIds = proposed.map((d) => d.id)
  const selectedProposed = proposedIds.filter((id) => selected.has(id))

  return (
    <div className="space-y-6">
      <ScanBanner
        statuses={statuses}
        scanning={scanning}
        pending={isPending}
        onScan={onScan}
        counts={{ proposed: proposed.length, ignored: ignored.length, imported: imported.length }}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="proposed">Proposed ({proposed.length})</TabsTrigger>
          <TabsTrigger value="ignored">Ignored ({ignored.length})</TabsTrigger>
          <TabsTrigger value="imported">Imported ({imported.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="proposed" className="space-y-4 pt-4">
          {proposed.length === 0 ? (
            <EmptyState importedCount={imported.length} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={
                      selectedProposed.length > 0 && selectedProposed.length === proposedIds.length
                    }
                    onCheckedChange={(c) => toggleAll(proposedIds, c === true)}
                    aria-label="Select all proposals"
                  />
                  Select all
                </label>
                {selectedProposed.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selectedProposed.length} selected
                    </span>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => onApprove(selectedProposed)}
                    >
                      <Check className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => onIgnore(selectedProposed)}
                    >
                      <X className="mr-1 h-4 w-4" /> Ignore
                    </Button>
                  </div>
                )}
              </div>

              {groupByRepo(proposed).map((group) => (
                <Card key={group.key}>
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div className="font-medium">{group.key}</div>
                      {group.url && (
                        <a
                          href={group.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Repository <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <ul className="divide-y">
                      {group.rows.map((row) => (
                        <ProposalRow
                          key={row.id}
                          row={row}
                          selectable
                          selected={selected.has(row.id)}
                          onToggle={() => toggle(row.id)}
                          note={notes.get(row.id)}
                          pending={isPending}
                          onApprove={() => onApprove([row.id])}
                          onIgnore={() => onIgnore([row.id])}
                        />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        <TabsContent value="ignored" className="space-y-4 pt-4">
          {ignored.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No ignored proposals.</p>
          ) : (
            groupByRepo(ignored).map((group) => (
              <Card key={group.key}>
                <CardContent className="p-0">
                  <div className="border-b px-4 py-3 font-medium">{group.key}</div>
                  <ul className="divide-y">
                    {group.rows.map((row) => (
                      <ProposalRow
                        key={row.id}
                        row={row}
                        note={notes.get(row.id)}
                        pending={isPending}
                        onApprove={() => onApprove([row.id])}
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="imported" className="space-y-4 pt-4">
          {imported.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing imported yet.
            </p>
          ) : (
            groupByRepo(imported).map((group) => (
              <Card key={group.key}>
                <CardContent className="p-0">
                  <div className="border-b px-4 py-3 font-medium">{group.key}</div>
                  <ul className="divide-y">
                    {group.rows.map((row) => (
                      <ProposalRow key={row.id} row={row} imported />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ScanBanner({
  statuses,
  scanning,
  pending,
  onScan,
  counts,
}: {
  statuses: ScanStatusEntry[]
  scanning: boolean
  pending: boolean
  onScan: () => void
  counts: { proposed: number; ignored: number; imported: number }
}) {
  const lastCompleted = statuses
    .filter((s) => s.status === 'completed' && s.lastRunAt)
    .map((s) => s.lastRunAt as string)
    .sort()
    .at(-1)
  const failed = statuses.some((s) => s.status === 'failed')

  let statusText: string
  if (scanning) statusText = 'Scanning repositories…'
  else if (failed) statusText = 'The last scan did not finish. Try running it again.'
  else if (lastCompleted) statusText = `Last scan completed ${new Date(lastCompleted).toLocaleString()}.`
  else statusText = 'No scan has run yet.'

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <p className={cn('text-sm', failed && !scanning ? 'text-destructive' : 'text-muted-foreground')}>
          {statusText}
        </p>
        <p className="text-xs text-muted-foreground">
          {counts.proposed} proposed · {counts.imported} imported · {counts.ignored} ignored
        </p>
      </div>
      <Button onClick={onScan} disabled={pending || scanning}>
        {scanning ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {scanning ? 'Scanning…' : 'Scan organization'}
      </Button>
    </div>
  )
}

function ProposalRow({
  row,
  selectable = false,
  selected = false,
  onToggle,
  note,
  pending = false,
  onApprove,
  onIgnore,
  imported = false,
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

          {imported && row.importedRef?.collection && (
            <p className="text-xs text-muted-foreground">
              Imported into <span className="font-mono">{row.importedRef.collection}</span>
            </p>
          )}
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

function EmptyState({ importedCount }: { importedCount: number }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
      <Search className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">No proposals to review</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {importedCount > 0
          ? `Repositories with a .orbit.yaml manifest import automatically — ${importedCount} ${
              importedCount === 1 ? 'entity has' : 'entities have'
            } already been imported. Run a scan to look for more.`
          : 'Run a scan to detect services and APIs across your connected repositories. Repositories with a .orbit.yaml manifest are imported automatically; everything else lands here for review.'}
      </p>
    </div>
  )
}
