import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, Pencil, Zap, Clock, CalendarClock } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { RunStatusBadge } from '@/components/features/actions/RunStatusBadge'
import { formatRelativeTime } from '@/components/features/actions/action-ui'
import { getAutomationDetail, type AutomationNextRun } from '../actions'

/**
 * Automation detail (IDP refocus P4.1) — read-only observability for a single
 * automation: its configuration, when it last ran + that run's outcome, the next
 * run (a real time for cron schedules; a descriptive label for event triggers),
 * and a recent-runs history. Viewable by any workspace member; Edit is shown only
 * to owner/admin (server-computed `canManage`).
 */

const EVENT_LABEL: Record<string, string> = {
  'rule-result-changed': 'Scorecard rule result changed',
  'entity-changed': 'Catalog entity changed',
  schedule: 'Schedule (cron)',
}

function eventLabel(event: string): string {
  return EVENT_LABEL[event] ?? event
}

function NextRun({ nextRun, enabled }: { nextRun: AutomationNextRun; enabled: boolean }) {
  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Disabled — this automation will not run until it is re-enabled.
      </p>
    )
  }
  if (nextRun.kind === 'event') {
    return (
      <p className="text-sm">
        Event-driven — runs on the next matching{' '}
        <span className="font-medium">{eventLabel(nextRun.event)}</span> event. No fixed schedule.
      </p>
    )
  }
  // schedule
  return (
    <div className="text-sm">
      {nextRun.at ? (
        <span className="font-medium">{new Date(nextRun.at).toLocaleString()}</span>
      ) : (
        <span className="text-muted-foreground">
          Could not compute a next time — check the cron expression.
        </span>
      )}
      <span className="ml-2 text-muted-foreground">
        (<code>{nextRun.cron}</code>)
      </span>
      <p className="mt-1 text-xs text-muted-foreground">
        Scheduled execution is handled by the (deferred) Temporal worker.
      </p>
    </div>
  )
}

function KeyValueList({ data, arrow }: { data: Record<string, unknown>; arrow?: boolean }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return <span className="text-sm text-muted-foreground">None</span>
  return (
    <ul className="space-y-1">
      {entries.map(([k, v]) => (
        <li key={k} className="font-mono text-xs">
          <span className="text-foreground">{k}</span>
          <span className="mx-1 text-muted-foreground">{arrow ? '→' : '='}</span>
          <span className="text-muted-foreground">
            {typeof v === 'string' ? v : JSON.stringify(v)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  const a = await getAutomationDetail(user?.id, id)
  if (!a) notFound()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/automations"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Automations
            </Link>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Zap className="h-6 w-6 text-muted-foreground" />
                  <h1 className="text-3xl font-bold">{a.name}</h1>
                  {a.enabled ? (
                    <Badge variant="secondary">Enabled</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </div>
                {a.description && <p className="mt-2 text-muted-foreground">{a.description}</p>}
                {a.workspaceName && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Workspace: {a.workspaceName}
                  </p>
                )}
              </div>
              {a.canManage && (
                <Button asChild variant="outline">
                  <Link href={`/automations/${a.id}/edit`}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
                <CardDescription>What this automation watches and what it does.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Trigger">
                  <Badge variant="secondary">{a.event}</Badge>
                  <span className="ml-2 text-sm text-muted-foreground">{eventLabel(a.event)}</span>
                </Field>
                {a.event === 'schedule' && (
                  <Field label="Schedule">
                    {a.schedule ? (
                      <code className="text-sm">{a.schedule}</code>
                    ) : (
                      <span className="text-sm text-muted-foreground">None</span>
                    )}
                  </Field>
                )}
                <Field label="Filter">
                  <KeyValueList data={a.filter ?? {}} />
                </Field>
                <Field label="Runs action">
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{a.actionName ?? 'Unknown action'}</span>
                  </div>
                </Field>
                <Field label="Input mapping">
                  <KeyValueList data={a.inputMapping ?? {}} arrow />
                </Field>
              </CardContent>
            </Card>

            {/* Execution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Execution</CardTitle>
                <CardDescription>When it last ran, the outcome, and what&rsquo;s next.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Last run">
                  {a.lastRun ? (
                    <Link
                      href={`/self-service/runs/${a.lastRun.id}`}
                      className="inline-flex items-center gap-2 text-sm hover:underline"
                    >
                      <RunStatusBadge status={a.lastRun.status} />
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatRelativeTime(a.lastRun.createdAt)}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  ) : a.lastTriggeredAt ? (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Triggered {formatRelativeTime(a.lastTriggeredAt)} (run record unavailable)
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Has not run yet.</span>
                  )}
                </Field>
                <Field label="Next run">
                  <div className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <NextRun nextRun={a.nextRun} enabled={a.enabled} />
                  </div>
                </Field>
              </CardContent>
            </Card>
          </div>

          {/* Recent runs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription>The last {a.recentRuns.length || 'few'} executions.</CardDescription>
            </CardHeader>
            <CardContent>
              {a.recentRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No runs yet. This automation creates a run each time its trigger fires.
                </p>
              ) : (
                <div className="divide-y">
                  {a.recentRuns.map((r) => (
                    <Link
                      key={r.id}
                      href={`/self-service/runs/${r.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-muted/40 -mx-2 px-2 rounded"
                    >
                      <div className="flex items-center gap-3">
                        <RunStatusBadge status={r.status} />
                        <span className="text-muted-foreground">{formatRelativeTime(r.createdAt)}</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
