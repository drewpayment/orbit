import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

import { AgentChatThread } from '@/components/features/infra-agent/AgentChatThread'
import { SetAgentBreadcrumbs } from '@/components/features/infra-agent/SetAgentBreadcrumbs'
import {
  mapPersistedEvent,
  type PersistedAgentEvent,
} from '@/components/features/infra-agent/lib/agent-event-dto'

interface Props {
  params: Promise<{ slug: string; runId: string }>
}

export default async function AgentRunPage({ params }: Props) {
  const { slug, runId } = await params
  const workflowId = decodeURIComponent(runId)

  const user = await getPayloadUserFromSession()
  if (!user) redirect('/sign-in')

  const payload = await getPayload({ config })
  const wsResult = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  const workspace = wsResult.docs[0]
  if (!workspace) notFound()
  if (!(await isWorkspaceMember(payload, user.id, workspace.id))) notFound()

  const runResult = await payload.find({
    collection: 'agent-runs',
    where: { workflowId: { equals: workflowId } },
    limit: 1,
    depth: 1,
  })
  const run = runResult.docs[0]
  if (!run) notFound()

  // Resolve the app + LLM provider for the context strip. App may be a
  // string id (depth=0) or hydrated object (depth>=1); same for the
  // provider. Depth=1 above hydrates one level which is what we want.
  const appDoc =
    typeof run.repository === 'string' || run.repository == null ? null : run.repository
  const llmDoc =
    typeof run.llmProvider === 'string' || run.llmProvider == null ? null : run.llmProvider

  // First connected cloud account in this workspace (best effort — empty
  // if none configured yet).
  const cloudAccountsResult = await payload.find({
    collection: 'cloud-accounts',
    where: { workspaces: { contains: workspace.id }, status: { equals: 'connected' } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const cloudDoc = cloudAccountsResult.docs[0] ?? null

  // Backfill the durable transcript so reopening a run (even one whose
  // Temporal workflow has been purged) renders its full history. These map
  // through the same DTO mapper the live SSE stream uses, so persisted events
  // render identically to streamed ones.
  const persistedEventsResult = await payload.find({
    collection: 'agent-events',
    where: { workflowId: { equals: workflowId } },
    sort: 'sequence',
    limit: 1000,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  const initialEvents = persistedEventsResult.docs.map((doc) =>
    mapPersistedEvent(doc as unknown as PersistedAgentEvent),
  )

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <SetAgentBreadcrumbs
          workspaceSlug={workspace.slug}
          workspaceName={workspace.name}
          runTitle={run.title ?? run.initialPrompt ?? 'Agent run'}
        />
        <div className="flex flex-1 min-h-0 flex-col p-6">
          <div className="container mx-auto max-w-4xl flex flex-1 min-h-0 flex-col">
            <AgentChatThread
              workspaceId={workspace.id}
              workflowId={workflowId}
              initialEvents={initialEvents}
              initialStatus={run.status}
              context={{
                title: run.title ?? run.initialPrompt ?? 'Agent run',
                startedAtIso: run.startedAt ?? new Date().toISOString(),
                workspaceName: workspace.name,
                appName: appDoc?.name ?? undefined,
                appFramework: undefined,
                cloudName: cloudDoc?.name ?? undefined,
                cloudProvider:
                  (cloudDoc as { provider?: string } | null)?.provider ?? undefined,
                cloudRegion: (cloudDoc as { region?: string } | null)?.region ?? undefined,
                llmModel: llmDoc?.model ?? undefined,
              }}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
