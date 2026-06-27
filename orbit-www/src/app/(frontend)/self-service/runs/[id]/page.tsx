import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RunStatusBadge } from '@/components/features/actions/RunStatusBadge'
import { RunLogs } from '@/components/features/actions/RunLogs'
import { ApprovalButtons } from '@/components/features/actions/ApprovalButtons'
import { RunRefreshButton } from '@/components/features/actions/RunRefreshButton'
import { formatRelativeTime, triggerLabel } from '@/components/features/actions/action-ui'
import type { ActionRun } from '@/payload-types'
import { getRun } from '../../actions'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Action Run detail (IDP refocus P3): status, inputs, outputs, error, an
 * append-only log view and a link to any produced catalog entity. A run at
 * `awaiting-approval` shows Approve / Reject controls (server-enforced).
 */
export default async function ActionRunDetailPage({ params }: PageProps) {
  const { id } = await params
  const user = await getCurrentUser()
  const run = await getRun(user?.id, id)
  if (!run) notFound()

  const actionName = resolveActionName(run.action)
  const entityId = resolveEntityId(run.entity)
  const inputs = asRecord(run.inputs)
  const outputs = asRecord(run.outputs)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service/runs"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Action Runs
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-bold">{actionName}</h1>
                  <RunStatusBadge status={run.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {triggerLabel(run.trigger)} run · started {formatRelativeTime(run.createdAt)}
                  {run.updatedAt !== run.createdAt && <> · updated {formatRelativeTime(run.updatedAt)}</>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {run.status === 'awaiting-approval' && <ApprovalButtons runId={run.id} />}
                <RunRefreshButton />
              </div>
            </div>
          </div>

          {run.error && (
            <Card className="border-red-500/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-600 dark:text-red-400">Error</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap break-words text-sm text-red-600 dark:text-red-400">
                  {run.error}
                </pre>
              </CardContent>
            </Card>
          )}

          {entityId && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Produced entity</CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/catalog/${entityId}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  View in catalog
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Inputs</CardTitle>
              </CardHeader>
              <CardContent>
                <KeyValueList record={inputs} emptyLabel="No inputs were collected." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Outputs</CardTitle>
              </CardHeader>
              <CardContent>
                <KeyValueList record={outputs} emptyLabel="No outputs produced yet." />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <RunLogs logs={run.logs} />
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** A flat key/value table for inputs/outputs; scalars inline, objects as JSON. */
function KeyValueList({
  record,
  emptyLabel,
}: {
  record: Record<string, unknown> | null
  emptyLabel: string
}) {
  const entries = record ? Object.entries(record) : []
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <dl className="space-y-2 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-3">
          <dt className="font-medium text-muted-foreground">{key}</dt>
          <dd className="break-words font-mono text-xs">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function resolveActionName(action: ActionRun['action']): string {
  if (!action) return 'Action run'
  if (typeof action === 'string') return action
  return action.name ?? action.id
}

function resolveEntityId(entity: ActionRun['entity']): string | null {
  if (!entity) return null
  return typeof entity === 'string' ? entity : entity.id
}
