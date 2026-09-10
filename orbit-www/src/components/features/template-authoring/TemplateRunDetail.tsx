/**
 * Consumer run detail — Template Authoring Phase 2, Task 17.
 *
 * Live per-step status (via `useRunPolling`), whole-run logs (reusing
 * `RunLogs`), an outputs section rendering `run.outputs.links[]` as
 * anchors, and — when the run is `awaiting-approval` — the existing
 * `ApprovalButtons` (its `{ runId }` prop generalizes cleanly; no fork
 * needed).
 */
'use client'

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RunLogs } from '@/components/features/actions/RunLogs'
import { ApprovalButtons } from '@/components/features/actions/ApprovalButtons'
import { RunStatusBadge } from '@/components/features/actions/RunStatusBadge'
import { stepStatusPresentation } from '@/components/features/actions/action-ui'
import { ScaffolderApprovalGate } from './ScaffolderApprovalGate'
import { useRunPolling } from './use-run-polling'
import type { ActionRun } from '@/payload-types'
import {
  getScaffolderApprovalGates,
  type ScaffolderApprovalGateInfo,
} from '@/app/(frontend)/self-service/templates/run-actions'

export interface TemplateRunDetailProps {
  initialRun: ActionRun
  getRun: (id: string) => Promise<ActionRun | null>
  /**
   * Whether the current viewer may act on the run-level (pre-dispatch)
   * `awaiting-approval` gate — a server-side `canApproveActionRun` check
   * (workspace owner/admin, per the run's approval policy), computed by the
   * page and threaded through here rather than re-derived client-side.
   * Defaults to `true` (matching `ApprovalButtons`' own default) so existing
   * callers that don't pass it are unaffected; `ApprovalButtons` still
   * enforces the real gate server-side regardless of this prop (defense in
   * depth, not the authority).
   *
   * Distinct from an `approval:request` STEP's mid-run gate (Phase 4 Task
   * C), which is a separate mechanism keyed by {@link gates} — see the
   * component body for how the two are told apart.
   */
  canApprove?: boolean
  /**
   * `approval:request` step gates, keyed by step id — server-computed
   * (`getScaffolderApprovalGates`) since the message/approvers live on the
   * `pending-approvals` row, not on `action-runs.steps[]`. Missing/empty
   * when the run has no open mid-run gate, or on any lookup failure.
   *
   * This is the server component's ONE-TIME snapshot at first render — it
   * is never refreshed by a parent re-render, so a run that reaches
   * `awaiting-approval` only after this component mounted (the common case:
   * the run wizard's Submit does a client-side `router.push` straight to
   * this page while the run is still `pending`/`running`) would otherwise
   * show a read-only "waiting" card forever, missing the real Approve/
   * Reject controls, until a hard reload re-runs the server component. See
   * the effect below, which refetches once polling observes a step newly
   * `awaiting-approval` that this snapshot doesn't already cover.
   */
  gates?: Record<string, ScaffolderApprovalGateInfo>
  /**
   * Fetches fresh gate info for a run — defaults to the real server action.
   * Overridable so tests can inject a fake without going through the
   * `run-actions` module mock every other test in this file already uses
   * for `resolveScaffolderApproval`.
   */
  getGates?: (runId: string) => Promise<Record<string, ScaffolderApprovalGateInfo>>
}

interface OutputLinkLike {
  title?: string
  url?: string
  entity?: string
}

/** Only `http`/`https` URLs are rendered as clickable anchors — anything else (e.g. `javascript:`) is shown as plain text. */
function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://placeholder.invalid')
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function asOutputLinks(outputs: unknown): OutputLinkLike[] {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) return []
  const links = (outputs as Record<string, unknown>).links
  if (!Array.isArray(links)) return []
  return links.filter((l): l is OutputLinkLike => !!l && typeof l === 'object')
}

export function TemplateRunDetail({
  initialRun,
  getRun,
  canApprove = true,
  gates: initialGates = {},
  getGates = getScaffolderApprovalGates,
}: TemplateRunDetailProps) {
  const { run: polledRun } = useRunPolling(initialRun.id, getRun)
  const run = polledRun ?? initialRun

  const steps = Array.isArray(run.steps) ? run.steps : []
  const outputLinks = asOutputLinks(run.outputs)

  // A step at `awaiting-approval` means an `approval:request` step parked
  // the WHOLE run in that same status (Phase 4 Task C reuses the existing
  // enum value) — that is a different gate from the pre-dispatch
  // `approvalPolicy` one `ApprovalButtons` resolves, so it takes priority:
  // showing both for the same `run.status === 'awaiting-approval'` would be
  // confusing and `approveRun`/`rejectRun` would reject a run that was never
  // actually sitting at the pre-dispatch gate.
  const awaitingSteps = steps.filter((s) => s.status === 'awaiting-approval')

  // `gates` merges the server-rendered initial snapshot with anything this
  // effect fetches after the fact. Re-runs whenever polling delivers a new
  // `run.steps` (a fresh object every tick, per `useRunPolling`/`getRun`)
  // while some awaiting step still has no entry — which self-heals both the
  // "gates was empty on mount" case above AND the `OpenApproval` activity's
  // own race with the step-status writeback (the workflow flips the step to
  // `awaiting-approval` and writes progress BEFORE the pending-approvals row
  // exists — see scaffolder_approval.go's `runApprovalStep` — so the very
  // first poll to observe the step can still legitimately get back `{}`).
  // Stops re-fetching per step once that step's entry is present.
  const [gates, setGates] = React.useState(initialGates)
  React.useEffect(() => {
    const missing = awaitingSteps.some((s) => s.id && !gates[s.id])
    if (!missing) return
    let cancelled = false
    void (async () => {
      const fresh = await getGates(run.id)
      if (!cancelled && Object.keys(fresh).length > 0) {
        setGates((prev) => ({ ...prev, ...fresh }))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on step identity/status, not the steps array reference
  }, [run.id, steps.map((s) => `${s.id}:${s.status}`).join(',')])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
        </div>
        {run.status === 'awaiting-approval' && awaitingSteps.length === 0 && (
          <ApprovalButtons runId={run.id} canApprove={canApprove} />
        )}
      </div>

      {awaitingSteps.map((step) => {
        const gate = step.id ? gates[step.id] : undefined
        return (
          <ScaffolderApprovalGate
            key={step.id ?? step.name ?? 'gate'}
            runId={run.id}
            approvalId={gate?.approvalId ?? `${run.id}:${step.id ?? ''}`}
            message={gate?.message ?? step.name ?? 'A step in this run requires approval.'}
            canApprove={gate?.canApprove ?? false}
          />
        )
      })}

      {run.error && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-600 dark:text-red-400">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words text-sm text-red-600 dark:text-red-400">{run.error}</pre>
          </CardContent>
        </Card>
      )}

      {steps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="space-y-2">
              {steps.map((step, i) => {
                const presentation = stepStatusPresentation(step.status)
                return (
                  <li key={step.id ?? i} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{step.name ?? step.id}</span>
                      <Badge variant="outline" className={presentation.className}>
                        {presentation.label}
                      </Badge>
                    </div>
                    {step.logTail && (
                      <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
                        {step.logTail}
                      </pre>
                    )}
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {run.status === 'succeeded' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Outputs</CardTitle>
          </CardHeader>
          <CardContent>
            {outputLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outputs produced yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {outputLinks.map((link, i) => (
                  <li key={i}>
                    <OutputLink link={link} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <RunLogs logs={run.logs} />
        </CardContent>
      </Card>
    </div>
  )
}

function OutputLink({ link }: { link: OutputLinkLike }) {
  const label = link.title ?? link.entity ?? link.url ?? 'Output'

  if (link.entity) {
    return (
      <Link
        href={`/catalog/${encodeURIComponent(link.entity)}`}
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        {label}
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    )
  }

  if (link.url && isSafeHttpUrl(link.url)) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        {label}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    )
  }

  // Unsafe or missing url/entity — render as plain text rather than a dead
  // or (worse) an unsafe-scheme anchor.
  return <span className="text-muted-foreground">{label}</span>
}
