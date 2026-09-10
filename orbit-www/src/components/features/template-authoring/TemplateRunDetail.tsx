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
import { useRunPolling } from './use-run-polling'
import type { ActionRun } from '@/payload-types'

export interface TemplateRunDetailProps {
  initialRun: ActionRun
  getRun: (id: string) => Promise<ActionRun | null>
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

export function TemplateRunDetail({ initialRun, getRun }: TemplateRunDetailProps) {
  const { run: polledRun } = useRunPolling(initialRun.id, getRun)
  const run = polledRun ?? initialRun

  const steps = Array.isArray(run.steps) ? run.steps : []
  const outputLinks = asOutputLinks(run.outputs)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
        </div>
        {run.status === 'awaiting-approval' && <ApprovalButtons runId={run.id} />}
      </div>

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
        href={`/catalog/${link.entity}`}
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
