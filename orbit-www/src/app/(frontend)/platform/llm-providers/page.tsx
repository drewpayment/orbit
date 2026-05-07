import { redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

import { auth } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

import { LLMProvidersTable } from './llm-providers-table'

export const metadata = {
  title: 'LLM Providers — Platform Admin',
  description: 'Manage workspace LLM credentials for the Infrastructure Agent',
}

export default async function PlatformLLMProvidersPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/login')

  const payload = await getPayload({ config })
  const user = await payload.findByID({
    collection: 'users',
    id: session.user.id,
    overrideAccess: true,
  })
  if (!user || !isPlatformAdmin(user)) {
    redirect('/')
  }

  // Fetch every LLM provider plus every workspace, both with overrideAccess
  // so the admin sees the full set regardless of workspace membership.
  const [providersResult, workspacesResult] = await Promise.all([
    payload.find({
      collection: 'llm-providers',
      sort: 'workspace.name',
      limit: 200,
      depth: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'workspaces',
      sort: 'name',
      limit: 200,
      overrideAccess: true,
    }),
  ])

  const providers = providersResult.docs.map((doc) => ({
    id: doc.id,
    displayName: doc.displayName,
    provider: doc.provider,
    baseUrl: doc.baseUrl ?? '',
    model: doc.model,
    isDefault: Boolean(doc.isDefault),
    workspaceId: typeof doc.workspace === 'string' ? doc.workspace : doc.workspace?.id ?? '',
    workspaceName:
      typeof doc.workspace === 'string'
        ? ''
        : (doc.workspace as { name?: string } | null)?.name ?? '',
    updatedAt: doc.updatedAt,
  }))

  const workspaces = workspacesResult.docs.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="container mx-auto py-8 max-w-6xl space-y-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">LLM Providers</h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Bring-your-own LLM credentials the Infrastructure Agent uses to drive its
                conversation loop. API keys are encrypted at rest. The agent's runtime worker
                fetches the decrypted credential through an internal-only API gated by a shared
                secret — keys are never exposed to the browser.
              </p>
            </div>
            <Button asChild>
              <Link href="/platform/llm-providers/new">+ New provider</Link>
            </Button>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Configured providers</CardTitle>
              <CardDescription>
                {providers.length === 0
                  ? 'No providers configured yet — add one to enable Infrastructure Agent runs.'
                  : `${providers.length} provider${providers.length === 1 ? '' : 's'} across ${
                      new Set(providers.map((p) => p.workspaceId)).size
                    } workspace${new Set(providers.map((p) => p.workspaceId)).size === 1 ? '' : 's'}.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {providers.length === 0 ? (
                <EmptyState />
              ) : (
                <LLMProvidersTable providers={providers} workspaces={workspaces} />
              )}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
      <p className="text-sm text-muted-foreground">
        Once you add a provider for a workspace, members of that workspace can start
        Infrastructure Agent runs from{' '}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          /workspaces/{'{slug}'}/infra-agent
        </code>
        .
      </p>
      <div className="flex justify-center gap-2">
        <Button asChild>
          <Link href="/platform/llm-providers/new">Add your first provider</Link>
        </Button>
      </div>
      <div className="text-xs text-muted-foreground pt-2">
        <Badge variant="outline">Anthropic</Badge>{' '}
        <Badge variant="outline">OpenAI-compatible (OpenAI, LM Studio, Ollama, vLLM)</Badge>
      </div>
    </div>
  )
}
