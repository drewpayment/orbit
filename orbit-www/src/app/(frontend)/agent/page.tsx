import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

import { CrossWorkspaceAgentRunForm } from '@/components/features/infra-agent/CrossWorkspaceAgentRunForm'
import type {
  AppOption,
  ProviderOption,
} from '@/components/features/infra-agent/CrossWorkspaceAgentRunForm'
import { getPayloadUserFromSession } from '@/lib/auth/session'

// /agent — top-level Infrastructure Agent entry point.
//
// The agent doesn't *run* across workspaces (workspaces are the security
// enclave the workflow is scoped to). This page just lets a user pick
// any app they have access to *across* their workspaces and start a run
// against it — the picked app's workspace becomes the run's workspace,
// and all tool isolation continues to apply at the workflow layer.

export default async function AgentHubPage() {
  const user = await getPayloadUserFromSession()
  if (!user) redirect('/sign-in')

  const payload = await getPayload({ config })

  // Active workspace memberships → workspace ids.
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 100,
    depth: 1,
    overrideAccess: true,
  })

  const workspaces = memberships.docs
    .map((m) => (typeof m.workspace === 'string' ? null : m.workspace))
    .filter((w): w is NonNullable<typeof w> => w != null)

  const workspaceIds = workspaces.map((w) => w.id)
  const workspaceNameById = new Map(workspaces.map((w) => [w.id, w.name]))
  const workspaceSlugById = new Map(workspaces.map((w) => [w.id, w.slug]))

  if (workspaceIds.length === 0) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-4 p-8">
            <div className="container mx-auto max-w-5xl">
              <Card>
                <CardHeader>
                  <CardTitle>Join a workspace first</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  The Infra Agent runs deployments inside workspaces. You aren&apos;t a member of any
                  workspace yet — ask an admin to add you to one and come back.
                </CardContent>
              </Card>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // Apps across all workspaces the user belongs to. Workspace boundaries
  // are still enforced — this just unions the per-workspace lists.
  const [appsResult, providersResult, runsResult] = await Promise.all([
    payload.find({
      collection: 'apps',
      where: { workspace: { in: workspaceIds } },
      sort: 'name',
      limit: 200,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'llm-providers',
      where: { workspace: { in: workspaceIds } },
      sort: '-isDefault',
      limit: 100,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'agent-runs',
      where: { workspace: { in: workspaceIds } },
      sort: '-startedAt',
      limit: 50,
      depth: 0,
      overrideAccess: true,
    }),
  ])

  const apps: AppOption[] = appsResult.docs
    .map((a) => {
      const wsId = typeof a.workspace === 'string' ? a.workspace : a.workspace?.id
      if (!wsId) return null
      const wsName = workspaceNameById.get(wsId)
      const wsSlug = workspaceSlugById.get(wsId)
      if (!wsName || !wsSlug) return null
      return {
        id: a.id,
        name: a.name,
        workspaceId: wsId,
        workspaceName: wsName,
        workspaceSlug: wsSlug,
      }
    })
    .filter((a): a is AppOption => a != null)
    .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.name.localeCompare(b.name))

  const providers: ProviderOption[] = providersResult.docs
    .map((p): ProviderOption | null => {
      const wsId = typeof p.workspace === 'string' ? p.workspace : p.workspace?.id
      if (!wsId) return null
      return {
        id: p.id,
        displayName: p.displayName,
        provider: p.provider as string,
        model: p.model,
        isDefault: Boolean(p.isDefault),
        workspaceId: wsId,
      }
    })
    .filter((p): p is ProviderOption => p != null)

  const recentRuns = runsResult.docs.map((r) => {
    const wsId = typeof r.workspace === 'string' ? r.workspace : r.workspace?.id
    return {
      id: r.id,
      workflowId: r.workflowId,
      title: r.title ?? r.initialPrompt ?? '(no title)',
      status: r.status,
      startedAt: r.startedAt,
      workspaceName: wsId ? (workspaceNameById.get(wsId) ?? 'Unknown') : 'Unknown',
      workspaceSlug: wsId ? (workspaceSlugById.get(wsId) ?? null) : null,
    }
  })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto max-w-5xl space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Infrastructure Agent</h1>
              <p className="text-sm text-muted-foreground">
                Conversational deployments across your workspaces. Pick an app to deploy and describe
                what you want — each run stays scoped to that app&apos;s workspace.
              </p>
            </div>

            <CrossWorkspaceAgentRunForm apps={apps} providers={providers} />

            <Card>
              <CardHeader>
                <CardTitle>Recent runs</CardTitle>
              </CardHeader>
              <CardContent>
                {recentRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No runs yet. Start one above.</p>
                ) : (
                  <ul className="divide-y">
                    {recentRuns.map((run) => (
                      <li key={run.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0 flex-1">
                          {run.workspaceSlug ? (
                            <Link
                              href={`/workspaces/${run.workspaceSlug}/infra-agent/${encodeURIComponent(run.workflowId)}`}
                              className="block truncate font-medium hover:underline"
                            >
                              {run.title}
                            </Link>
                          ) : (
                            <span className="block truncate font-medium">{run.title}</span>
                          )}
                          <p className="truncate text-xs text-muted-foreground">
                            {run.workspaceName} · {new Date(run.startedAt).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default'
    case 'aborted':
    case 'failed':
    case 'timeout':
      return 'destructive'
    case 'awaiting_user':
    case 'awaiting_approval':
      return 'outline'
    default:
      return 'secondary'
  }
}
