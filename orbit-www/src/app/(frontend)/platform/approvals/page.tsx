import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import {
  isPlatformAdmin,
  getAdminOrOwnerWorkspaceIds,
  getMemberWorkspaceIds,
} from '@/lib/access/workspace-access'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pending Approvals — Platform Admin',
  description: 'Aggregated queue of Infrastructure Agent approval gates across workspaces',
}

const KIND_LABEL: Record<string, string> = {
  tool_registration: 'Tool registration',
  destructive_command: 'Destructive command',
  proposal: 'Proposal',
  custom: 'Custom',
}

const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  tool_registration: 'default',
  destructive_command: 'destructive',
  proposal: 'secondary',
  custom: 'outline',
}

/**
 * Spike 7 commit γ — /platform/approvals
 *
 * Aggregated, cross-workspace queue of every open Infrastructure Agent
 * approval gate. Platform admins see everything; workspace admins/owners
 * see only their workspaces' gates. Each row deep-links into the chat
 * thread anchored to the right approval card.
 */
export default async function PlatformApprovalsPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/login')

  const payload = await getPayload({ config })

  // Scope: platform admins see all; workspace admins/owners see their
  // workspaces; plain members see their workspaces too (read-only — but
  // the approve/reject buttons are gated server-side by gRPC and live in
  // the chat thread, so this page is a discovery surface for everyone).
  const platformAdmin = isPlatformAdmin(user)
  let workspaceFilter: Record<string, unknown> | undefined
  if (!platformAdmin) {
    const adminOwnerIds = await getAdminOrOwnerWorkspaceIds(payload, user.id)
    const memberIds = await getMemberWorkspaceIds(payload, user.id)
    const allowedWorkspaceIds = Array.from(new Set([...adminOwnerIds, ...memberIds]))
    if (allowedWorkspaceIds.length === 0) {
      redirect('/')
    }
    workspaceFilter = { workspace: { in: allowedWorkspaceIds } }
  }

  const baseWhere: any[] = [{ status: { equals: 'pending' } }]
  if (workspaceFilter) baseWhere.push(workspaceFilter)

  const result = await payload.find({
    collection: 'pending-approvals',
    where: { and: baseWhere },
    sort: '-createdAt',
    limit: 200,
    depth: 1,
    overrideAccess: true,
  })

  type WorkspaceRef = { id: string; name?: string; slug?: string }
  const rows = result.docs.map((doc) => ({
    id: doc.id,
    workflowId: doc.workflowId,
    runId: doc.runId ?? '',
    approvalId: doc.approvalId,
    kind: doc.kind,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown ?? '',
    reviewerRounds: doc.reviewerRounds ?? 0,
    createdAt: doc.createdAt,
    workspace:
      typeof doc.workspace === 'object' && doc.workspace !== null
        ? (doc.workspace as WorkspaceRef)
        : { id: String(doc.workspace ?? ''), name: '', slug: '' },
  }))

  // Bucket by workspace for the table — mirrors how a reviewer mentally
  // groups when triaging.
  const byWorkspace = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.workspace.id
    if (!byWorkspace.has(key)) byWorkspace.set(key, [])
    byWorkspace.get(key)!.push(row)
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="container mx-auto py-8 px-6 max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-semibold">Pending Approvals</h1>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">
              Open Infrastructure Agent approval gates. Tool registrations and destructive
              commands wait here until a workspace admin or owner approves or rejects them.
            </p>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>{rows.length} pending</CardTitle>
              <CardDescription>
                {rows.length === 0
                  ? 'Nothing pending right now. Approvals appear here automatically when an agent run hits a gate.'
                  : platformAdmin
                    ? `Across ${byWorkspace.size} workspace${byWorkspace.size === 1 ? '' : 's'}.`
                    : `In your workspaces.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <EmptyState />
              ) : (
                <ApprovalsTable rows={rows} />
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ApprovalsTable({
  rows,
}: {
  rows: Array<{
    id: string
    workflowId: string
    runId: string
    approvalId: string
    kind: string
    title: string
    reviewerRounds: number
    createdAt: string
    workspace: { id: string; name?: string; slug?: string }
  }>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Workspace</th>
            <th className="py-2 pr-3 font-medium">Kind</th>
            <th className="py-2 pr-3 font-medium">Title</th>
            <th className="py-2 pr-3 font-medium">Age</th>
            <th className="py-2 pr-3 font-medium">Rounds</th>
            <th className="py-2 pr-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const slug = row.workspace.slug ?? row.workspace.id
            const reviewLink = row.runId
              ? `/workspaces/${slug}/infra-agent/${row.runId}#approval-${row.approvalId}`
              : `/workspaces/${slug}/infra-agent`
            return (
              <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/40">
                <td className="py-3 pr-3 align-top">
                  <div className="font-medium">{row.workspace.name ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{slug}</div>
                </td>
                <td className="py-3 pr-3 align-top">
                  <Badge variant={KIND_VARIANT[row.kind] ?? 'outline'}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </Badge>
                </td>
                <td className="py-3 pr-3 align-top max-w-md">
                  <div className="font-medium">{row.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{row.workflowId.slice(0, 12)}…</div>
                </td>
                <td className="py-3 pr-3 align-top text-muted-foreground tabular-nums">
                  {formatAge(row.createdAt)}
                </td>
                <td className="py-3 pr-3 align-top tabular-nums">
                  {row.reviewerRounds > 0 ? row.reviewerRounds : '—'}
                </td>
                <td className="py-3 pr-3 align-top">
                  <Button asChild size="sm" variant="outline">
                    <Link href={reviewLink}>Review</Link>
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground space-y-2">
      <p>No open approval gates right now.</p>
      <p className="text-xs">
        When an agent run hits a tool-registration, destructive-command, or custom approval gate,
        a row appears here with a link straight to the chat thread.
      </p>
    </div>
  )
}

function formatAge(iso: string): string {
  const created = new Date(iso).getTime()
  if (Number.isNaN(created)) return '—'
  const ms = Date.now() - created
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`
  return `${Math.round(ms / 86_400_000)}d`
}
