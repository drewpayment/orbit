'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, RefreshCw, Search, X } from 'lucide-react'
import type { DiscoveredEntity } from '@/payload-types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  startInstallationScan,
  approveDiscoveries,
  ignoreDiscoveries,
  getInstallationScanStatus,
} from '@/app/actions/discovery'
import { groupByRepo, humanizeSkippedReason } from './discovery-ui'
import { ProposalRow } from './ProposalRow'

export interface GlobalInstallation {
  id: string
  installationId: string
  accountLogin: string
}

export interface GlobalWorkspaceOption {
  id: string
  name: string
}

export interface InstallationScanStatus {
  installationId: string
  status: 'running' | 'completed' | 'failed' | 'none'
  lastRunAt?: string
}

interface GlobalDiscoveryClientProps {
  installations: GlobalInstallation[]
  workspaces: GlobalWorkspaceOption[]
  discoveries: DiscoveredEntity[]
  scanStatuses: InstallationScanStatus[]
}

type Tab = 'proposed' | 'ignored' | 'imported'

const SCAN_POLL_MS = 5000

/**
 * Platform-level (workspace-less) discovery review queue (WP8). An admin picks a
 * GitHub installation, scans it globally (no workspace), then reviews the global
 * proposals. Each proposed row can be imported as a GLOBAL catalog entity
 * (default) or assigned to a workspace (which runs the normal apps/api-schemas
 * import in that workspace). Reuses ProposalRow + the discovery-ui helpers.
 */
export function GlobalDiscoveryClient({
  installations,
  workspaces,
  discoveries,
  scanStatuses,
}: GlobalDiscoveryClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('proposed')
  const [selectedInstallation, setSelectedInstallation] = useState<string>(
    installations[0]?.installationId ?? '',
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<Map<string, string>>(new Map())
  // Per-row workspace assignment: '' (or absent) = import as a global entity.
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())
  const [statuses, setStatuses] = useState<InstallationScanStatus[]>(scanStatuses)

  useEffect(() => setStatuses(scanStatuses), [scanStatuses])

  const proposed = useMemo(() => discoveries.filter((d) => d.status === 'proposed'), [discoveries])
  const ignored = useMemo(() => discoveries.filter((d) => d.status === 'ignored'), [discoveries])
  const imported = useMemo(() => discoveries.filter((d) => d.status === 'imported'), [discoveries])

  const currentStatus = statuses.find((s) => s.installationId === selectedInstallation)
  const scanning = currentStatus?.status === 'running'

  // While the selected installation's scan runs, poll status + pull new proposals.
  useEffect(() => {
    if (!scanning) return
    const timer = setInterval(async () => {
      const res = await getInstallationScanStatus(selectedInstallation)
      if (res.success) {
        setStatuses((prev) =>
          prev
            .filter((s) => s.installationId !== selectedInstallation)
            .concat({ installationId: selectedInstallation, status: res.status, lastRunAt: res.lastRunAt }),
        )
      }
      router.refresh()
    }, SCAN_POLL_MS)
    return () => clearInterval(timer)
  }, [scanning, selectedInstallation, router])

  const setNote = useCallback((id: string, note: string) => {
    setNotes((prev) => new Map(prev).set(id, note))
  }, [])
  const clearNote = useCallback((id: string) => {
    setNotes((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const setAssignment = useCallback((id: string, workspaceId: string) => {
    setAssignments((prev) => new Map(prev).set(id, workspaceId))
  }, [])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((ids: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const onScan = useCallback(() => {
    if (!selectedInstallation) {
      toast.error('Select a GitHub installation to scan.')
      return
    }
    startTransition(async () => {
      const res = await startInstallationScan(selectedInstallation)
      if (!res.success) {
        toast.error(res.error ?? 'Failed to start scan')
        return
      }
      toast.success('Scan started — proposals will appear as repositories are scanned.')
      const status = await getInstallationScanStatus(selectedInstallation)
      if (status.success) {
        setStatuses((prev) =>
          prev
            .filter((s) => s.installationId !== selectedInstallation)
            .concat({ installationId: selectedInstallation, status: status.status, lastRunAt: status.lastRunAt }),
        )
      }
      router.refresh()
    })
  }, [selectedInstallation, router])

  const applyApproveResults = useCallback(
    (results: { id: string; imported: boolean; skippedReason?: string }[]) => {
      let importedCount = 0
      for (const r of results) {
        if (r.imported) {
          importedCount++
          clearNote(r.id)
        } else {
          setNote(r.id, humanizeSkippedReason(r.skippedReason))
        }
      }
      const skipped = results.length - importedCount
      if (importedCount > 0) {
        toast.success(`Imported ${importedCount} ${importedCount === 1 ? 'entity' : 'entities'}.`)
      }
      if (skipped > 0) {
        toast.warning(`${skipped} proposal${skipped === 1 ? '' : 's'} could not be imported.`)
      }
    },
    [clearNote, setNote],
  )

  // Approve a single row, honouring its per-row workspace assignment.
  const onApproveRow = useCallback(
    (id: string) => {
      const ws = assignments.get(id)
      startTransition(async () => {
        const res = await approveDiscoveries([id], ws ? { assignWorkspaceId: ws } : {})
        if (!res.success) {
          toast.error(res.error ?? 'Failed to approve proposal')
          return
        }
        applyApproveResults(res.results)
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        router.refresh()
      })
    },
    [assignments, applyApproveResults, router],
  )

  // Bulk approve selected rows as GLOBAL entities (no workspace assignment).
  const onApproveSelectedGlobal = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      startTransition(async () => {
        const res = await approveDiscoveries(ids)
        if (!res.success) {
          toast.error(res.error ?? 'Failed to approve proposals')
          return
        }
        applyApproveResults(res.results)
        setSelected(new Set())
        router.refresh()
      })
    },
    [applyApproveResults, router],
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
        installations={installations}
        selectedInstallation={selectedInstallation}
        onSelectInstallation={setSelectedInstallation}
        status={currentStatus}
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
                      onClick={() => onApproveSelectedGlobal(selectedProposed)}
                    >
                      <Check className="mr-1 h-4 w-4" /> Import as global
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
                    <div className="border-b px-4 py-3 font-medium">{group.key}</div>
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
                          onApprove={() => onApproveRow(row.id)}
                          onIgnore={() => onIgnore([row.id])}
                          footer={
                            <WorkspaceAssignSelect
                              workspaces={workspaces}
                              value={assignments.get(row.id) ?? ''}
                              onChange={(ws) => setAssignment(row.id, ws)}
                            />
                          }
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
                        onApprove={() => onApproveRow(row.id)}
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
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing imported yet.</p>
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

/** Native workspace picker rendered in a proposed row's footer (WP8). */
function WorkspaceAssignSelect({
  workspaces,
  value,
  onChange,
}: {
  workspaces: GlobalWorkspaceOption[]
  value: string
  onChange: (workspaceId: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Import as
      <select
        className="h-8 rounded-md border bg-background px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Global entity</option>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            Workspace: {w.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function ScanBanner({
  installations,
  selectedInstallation,
  onSelectInstallation,
  status,
  scanning,
  pending,
  onScan,
  counts,
}: {
  installations: GlobalInstallation[]
  selectedInstallation: string
  onSelectInstallation: (installationId: string) => void
  status?: InstallationScanStatus
  scanning: boolean
  pending: boolean
  onScan: () => void
  counts: { proposed: number; ignored: number; imported: number }
}) {
  let statusText: string
  if (installations.length === 0) statusText = 'No GitHub installations are connected.'
  else if (scanning) statusText = 'Scanning repositories…'
  else if (status?.status === 'failed') statusText = 'The last scan did not finish. Try running it again.'
  else if (status?.status === 'completed' && status.lastRunAt)
    statusText = `Last scan completed ${new Date(status.lastRunAt).toLocaleString()}.`
  else statusText = 'No scan has run for this installation yet.'

  const failed = status?.status === 'failed'

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
      <div className="flex items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={selectedInstallation}
          onChange={(e) => onSelectInstallation(e.target.value)}
          disabled={installations.length === 0 || scanning}
          aria-label="GitHub installation"
        >
          {installations.map((inst) => (
            <option key={inst.id} value={inst.installationId}>
              {inst.accountLogin}
            </option>
          ))}
        </select>
        <Button onClick={onScan} disabled={pending || scanning || installations.length === 0}>
          {scanning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {scanning ? 'Scanning…' : 'Scan installation'}
        </Button>
      </div>
    </div>
  )
}

function EmptyState({ importedCount }: { importedCount: number }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
      <Search className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">No global proposals to review</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {importedCount > 0
          ? `Repositories with a .orbit.yaml manifest import automatically as global entities — ${importedCount} ${
              importedCount === 1 ? 'entity has' : 'entities have'
            } already been imported. Scan an installation to look for more.`
          : 'Pick a GitHub installation and scan it to detect services and APIs across every repository, without tying them to a workspace. Repositories with a .orbit.yaml manifest are imported automatically as global entities; everything else lands here for review.'}
      </p>
    </div>
  )
}
