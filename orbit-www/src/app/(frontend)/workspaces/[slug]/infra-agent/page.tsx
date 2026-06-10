import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getPayloadUserFromSession } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/access/workspace-access'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

import { NewAgentRunForm } from '@/components/features/infra-agent/NewAgentRunForm'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function InfraAgentRunsPage({ params }: Props) {
  const { slug } = await params
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

  const [runs, providers] = await Promise.all([
    payload.find({
      collection: 'agent-runs',
      where: { workspace: { equals: workspace.id } },
      sort: '-startedAt',
      limit: 50,
      depth: 1,
    }),
    payload.find({
      collection: 'llm-providers',
      where: { workspace: { equals: workspace.id } },
      sort: '-isDefault',
      limit: 50,
    }),
  ])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Infrastructure Agent</h1>
          <p className="text-sm text-muted-foreground">
            Conversational deployments. Describe what you want; review and approve before anything runs.
          </p>
        </div>
      </div>

      {providers.docs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Configure an LLM provider first</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The agent needs an LLM credential before it can talk to a model. Ask a platform admin
              to add one for this workspace from the platform-admin{' '}
              <strong>LLM Providers</strong> page, then return here.
            </p>
            <Button asChild>
              <Link href="/platform/llm-providers">Open LLM Providers (admin)</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <NewAgentRunForm
          workspaceId={workspace.id}
          providers={providers.docs.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            provider: p.provider,
            model: p.model,
            isDefault: Boolean(p.isDefault),
          }))}
          slug={slug}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet. Start one above.</p>
          ) : (
            <ul className="divide-y">
              {runs.docs.map((run) => (
                <li key={run.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/workspaces/${slug}/infra-agent/${encodeURIComponent(run.workflowId)}`}
                      className="font-medium hover:underline truncate block"
                    >
                      {run.title}
                    </Link>
                    <p className="text-xs text-muted-foreground truncate">
                      {new Date(run.startedAt).toLocaleString()}
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
