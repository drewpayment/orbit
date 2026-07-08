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
import { startConnectionScan, getConnectionScanStatus } from '@/app/actions/git-connections'
import { groupByRepo, humanizeSkippedReason } from './discovery-ui'
import { ProposalRow } from './ProposalRow'

export interface GlobalInstallation {
  id: string
  installationId: string
  accountLogin: string
}

/** An Azure DevOps (git-connections) scan target for the discovery picker (WP11). */
export interface GlobalConnection {
  id: string
  name: string
  provider: string
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

export interface ConnectionScanStatus {
  connectionId: string
  status: 'running' | 'completed' | 'failed' | 'none'
  lastRunAt?: string
}

type ScanStatusValue = { status: 'running' | 'completed' | 'failed' | 'none'; lastRunAt?: string }

/**
 * A unified scan target for the picker: a GitHub installation (`github`, keyed on
 * the numeric installation id) or an Azure DevOps connection (`ado`, keyed on the
 * git-connections doc id). `key` is the composite `${kind}:${id}` used as the
 * <select> value and the status-map key.
 */
type ScanTarget =
  | { kind: 'github'; id: string; label: string; key: string }
  | { kind: 'ado'; id: string; label: string; key: string }

const targetKey = (kind: 'github' | 'ado', id: string) => `${kind}:${id}`

interface GlobalDiscoveryClientProps {
  installations: GlobalInstallation[]
  connections: GlobalConnection[]
  workspaces: GlobalWorkspaceOption[]
  discoveries: DiscoveredEntity[]
  scanStatuses: InstallationScanStatus[]
  connectionScanStatuses: ConnectionScanStatus[]
}

type Tab = 'proposed' | 'ignored' | 'imported'

const SCAN_POLL_MS = 5000

const PROVIDER_LABEL: Record<string, string> = { 'azure-devops': 'Azure DevOps' }

/**
 * Platform-level (workspace-less) discovery review queue (WP8). An admin picks a
 * GitHub installation, scans it globally (no workspace), then reviews the global
 * proposals. Each proposed row can be imported as a GLOBAL catalog entity
 * (default) or assigned to a workspace (which runs the normal apps/api-schemas
 * import in that workspace). Reuses ProposalRow + the discovery-ui helpers.
 */
export function GlobalDiscoveryClient({
  installations,
  connections,
  workspaces,
  discoveries,
  scanStatuses,
  connectionScanStatuses,
}: GlobalDiscoveryClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('proposed')

  // Unified GitHub + Azure DevOps scan targets for the picker (WP11).
  const targets = useMemo<ScanTarget[]>(() => {
    const gh: ScanTarget[] = installations.map((i) => ({
      kind: 'github',
      id: i.installationId,
      label: `GitHub · ${i.accountLogin}`,
      key: targetKey('github', i.installationId),
    }))
    const ado: ScanTarget[] = connections.map((c) => ({
      kind: 'ado',
      id: c.id,
      label: `${PROVIDER_LABEL[c.provider] ?? c.provider} · ${c.name}`,
      key: targetKey('ado', c.id),
    }))
    return [...gh, ...ado]
  }, [installations, connections])

  const [selectedKey, setSelectedKey] = useState<string>(targets[0]?.key ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<Map<string, string>>(new Map())
  // Per-row workspace assignment: '' (or absent) = import as a global entity.
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())

  // Scan status keyed on the composite target key, seeded from both providers.
  const [statusByKey, setStatusByKey] = useState<Record<string, ScanStatusValue>>({})
  useEffect(() => {
    const next: Record<string, ScanStatusValue> = {}
    for (const s of scanStatuses)
      next[targetKey('github', s.installationId)] = { status: s.status, lastRunAt: s.lastRunAt }
    for (const s of connectionScanStatuses)
      next[targetKey('ado', s.connectionId)] = { status: s.status, lastRunAt: s.lastRunAt }
    setStatusByKey(next)
  }, [scanStatuses, connectionScanStatuses])

  const proposed = useMemo(() => discoveries.filter((d) => d.status === 'proposed'), [discoveries])
  const ignored = useMemo(() => discoveries.filter((d) => d.status === 'ignored'), [discoveries])
  const imported = useMemo(() => discoveries.filter((d) => d.status === 'imported'), [discoveries])

  const selectedTarget = targets.find((t) => t.key === selectedKey)
  const currentStatus = statusByKey[selectedKey]
  const scanning = currentStatus?.status === 'running'

  const fetchStatus = useCallback(
    async (target: ScanTarget): Promise<ScanStatusValue | null> => {
      if (target.kind === 'github') {
        const res = await getInstallationScanStatus(target.id)
        return res.success ? { status: res.status, lastRunAt: res.lastRunAt } : null
      }
      const res = await getConnectionScanStatus(target.id)
      return res.success ? { status: res.status, lastRunAt: res.lastRunAt } : null
    },
    [],
  )

  // While the selected target's scan runs, poll status + pull new proposals.
  useEffect(() => {
    if (!scanning || !selectedTarget) return
    const timer = setInterval(async () => {
      const next = await fetchStatus(selectedTarget)
      if (next) setStatusByKey((prev) => ({ ...prev, [selectedTarget.key]: next }))
      router.refresh()
    }, SCAN_POLL_MS)
    return () => clearInterval(timer)
  }, [scanning, selectedTarget, fetchStatus, router])

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
    if (!selectedTarget) {
      toast.error('Select a connection to scan.')
      return
    }
    const target = selectedTarget
    startTransition(async () => {
      const res =
        target.kind === 'github'
          ? await startInstallationScan(target.id)
          : await startConnectionScan(target.id)
      if (!res.success) {
        toast.error(res.error ?? 'Failed to start scan')
        return
      }
      toast.success('Scan started — proposals will appear as repositories are scanned.')
      const next = await fetchStatus(target)
      if (next) setStatusByKey((prev) => ({ ...prev, [target.key]: next }))
      router.refresh()
    })
  }, [selectedTarget, fetchStatus, router])

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
        targets={targets}
        selectedKey={selectedKey}
        onSelectKey={setSelectedKey}
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
  targets,
  selectedKey,
  onSelectKey,
  status,
  scanning,
  pending,
  onScan,
  counts,
}: {
  targets: ScanTarget[]
  selectedKey: string
  onSelectKey: (key: string) => void
  status?: ScanStatusValue
  scanning: boolean
  pending: boolean
  onScan: () => void
  counts: { proposed: number; ignored: number; imported: number }
}) {
  let statusText: string
  if (targets.length === 0) statusText = 'No GitHub installations or git connections are configured.'
  else if (scanning) statusText = 'Scanning repositories…'
  else if (status?.status === 'failed') statusText = 'The last scan did not finish. Try running it again.'
  else if (status?.status === 'completed' && status.lastRunAt)
    statusText = `Last scan completed ${new Date(status.lastRunAt).toLocaleString()}.`
  else statusText = 'No scan has run for this target yet.'

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
          value={selectedKey}
          onChange={(e) => onSelectKey(e.target.value)}
          disabled={targets.length === 0 || scanning}
          aria-label="Scan target"
        >
          {targets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.kind === 'ado' ? `${t.label} (Azure DevOps)` : t.label}
            </option>
          ))}
        </select>
        <Button onClick={onScan} disabled={pending || scanning || targets.length === 0}>
          {scanning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {scanning ? 'Scanning…' : 'Scan repositories'}
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
