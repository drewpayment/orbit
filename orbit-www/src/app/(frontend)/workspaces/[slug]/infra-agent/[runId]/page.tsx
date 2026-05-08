import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

import { AgentChatThread } from '@/components/features/infra-agent/AgentChatThread'

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
  })
  const run = runResult.docs[0]
  if (!run) notFound()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 min-h-0 flex-col p-6">
          <div className="container mx-auto max-w-4xl flex flex-1 min-h-0 flex-col">
            <header className="mb-4">
              <h1 className="text-xl font-semibold truncate">{run.title}</h1>
              <p className="text-xs text-muted-foreground">
                Started {new Date(run.startedAt).toLocaleString()} • {workflowId}
              </p>
            </header>
            <div className="flex-1 min-h-0">
              <AgentChatThread workspaceId={workspace.id} workflowId={workflowId} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
