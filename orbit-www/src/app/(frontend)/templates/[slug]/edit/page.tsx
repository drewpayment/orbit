import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TemplateManagementForm } from '@/components/features/templates/TemplateManagementForm'
import { TemplateSyncStatus } from '@/components/features/templates/TemplateSyncStatus'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function TemplateEditPage({ params }: PageProps) {
  const { slug } = await params
  const payload = await getPayload({ config })

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/api/auth/signin')
  }

  // Fetch template
  const templatesResult = await payload.find({
    collection: 'templates',
    where: {
      slug: { equals: slug },
    },
    limit: 1,
  })

  if (templatesResult.docs.length === 0) {
    notFound()
  }

  const template = templatesResult.docs[0]
  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

  // Check if user is admin/owner in the template's workspace
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { role: { in: ['owner', 'admin'] } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    redirect(`/templates/${slug}`)
  }

  const isOwner = membership.docs[0].role === 'owner'

  // Get available workspaces for sharing (user must be member)
  const userMemberships = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1000,
  })

  const workspaceIds = userMemberships.docs.map((m) =>
    typeof m.workspace === 'string' ? m.workspace : m.workspace.id
  )

  const workspacesResult = await payload.find({
    collection: 'workspaces',
    where: {
      id: { in: workspaceIds },
    },
    limit: 1000,
  })

  const availableWorkspaces = workspacesResult.docs.map((w) => ({
    id: w.id as string,
    name: w.name,
  }))

  // Get workspace info
  const workspace = await payload.findByID({
    collection: 'workspaces',
    id: workspaceId,
  })

  // Get sharedWith workspace details
  const sharedWithIds = Array.isArray(template.sharedWith)
    ? template.sharedWith.map((w) => (typeof w === 'string' ? w : w.id))
    : []

  let sharedWithWorkspaces: { id: string; name: string }[] = []
  if (sharedWithIds.length > 0) {
    const sharedResult = await payload.find({
      collection: 'workspaces',
      where: {
        id: { in: sharedWithIds },
      },
      limit: 1000,
    })
    sharedWithWorkspaces = sharedResult.docs.map((w) => ({
      id: w.id as string,
      name: w.name,
    }))
  }

  const templateData = {
    id: template.id as string,
    name: template.name,
    slug: template.slug,
    description: template.description || null,
    visibility: template.visibility,
    sharedWith: sharedWithWorkspaces,
    workspace: {
      id: workspaceId,
      name: workspace.name,
    },
  }

  // Get webhook configuration
  const hasWebhook = !!template.webhookId
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const webhookUrl = `${appUrl}/api/webhooks/github/template-sync`

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Edit Template</h1>
              <p className="text-muted-foreground mt-2">
                Update template settings and visibility.
              </p>
            </div>

            {/* Sync Status */}
            <Card>
              <CardHeader>
                <CardTitle>Manifest Sync Status</CardTitle>
              </CardHeader>
              <CardContent>
                <TemplateSyncStatus
                  templateId={template.id as string}
                  syncStatus={template.syncStatus ?? 'pending'}
                  syncError={template.syncError}
                  lastSyncedAt={template.lastSyncedAt}
                  canSync={true}
                />
              </CardContent>
            </Card>

            {/* Form */}
            <TemplateManagementForm
              template={templateData}
              availableWorkspaces={availableWorkspaces}
              canDelete={isOwner}
              hasWebhook={hasWebhook}
              webhookUrl={webhookUrl}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
