import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { ArrowLeft } from 'lucide-react'
import { LaunchWizard } from '@/components/features/launches/LaunchWizard'
import type { TemplateDoc, CloudAccountDoc } from '@/components/features/launches/LaunchWizard'

export default async function NewLaunchPage() {
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex-1 flex items-center justify-center">
            <Card>
              <CardHeader>
                <CardTitle>Sign in to create a launch</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // Get user's workspace memberships
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: session.user.id },
      status: { equals: 'active' },
    },
    limit: 1000,
  })

  const workspaceIds = memberships.docs.map(m =>
    String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
  )

  // Use the first workspace as default (user can change if multi-workspace support is added later)
  const workspaceId = workspaceIds[0] || ''

  // Fetch templates and cloud accounts in parallel
  // Note: Using 'as any' because Payload types haven't been regenerated for new collections
  const [templatesResult, cloudAccountsResult] = await Promise.all([
    payload.find({
      collection: 'launch-templates' as any,
      limit: 100,
    }),
    workspaceId
      ? payload.find({
          collection: 'cloud-accounts' as any,
          where: {
            and: [
              { workspaces: { contains: workspaceId } },
              { status: { equals: 'connected' } },
            ],
          },
          limit: 100,
        })
      : Promise.resolve({ docs: [] as any[] }),
  ])

  const templates: TemplateDoc[] = (templatesResult.docs as any[]).map((doc: any) => ({
    id: doc.id,
    name: doc.name,
    slug: doc.slug,
    description: doc.description,
    type: doc.type as 'bundle' | 'resource',
    provider: doc.provider,
    category: doc.category,
    parameterSchema: doc.parameterSchema,
    estimatedDuration: doc.estimatedDuration || null,
    crossProviderSlugs: doc.crossProviderSlugs,
    icon: doc.icon || null,
  }))

  const cloudAccounts: CloudAccountDoc[] = (cloudAccountsResult.docs as any[]).map((doc: any) => ({
    id: doc.id,
    name: doc.name,
    provider: doc.provider,
    region: doc.region || null,
    approvalRequired: doc.approvalRequired || false,
    status: doc.status || undefined,
  }))

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/launches">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold">New Launch</h1>
              <p className="text-muted-foreground">
                Deploy infrastructure from a template
              </p>
            </div>
          </div>

          {workspaceId ? (
            <LaunchWizard
              templates={templates}
              cloudAccounts={cloudAccounts}
              workspaceId={workspaceId}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No workspace found</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  You need to be a member of a workspace to create launches.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
