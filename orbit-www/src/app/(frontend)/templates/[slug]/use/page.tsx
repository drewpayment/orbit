import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { UseTemplateForm } from '@/components/features/templates/UseTemplateForm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getGitHubHealth } from '@/app/actions/templates'

interface PageProps {
  params: Promise<{ slug: string }>
}

const languageEmoji: Record<string, string> = {
  typescript: '🔷',
  javascript: '🟨',
  go: '🔵',
  python: '🐍',
  rust: '🦀',
  java: '☕',
  ruby: '💎',
}

export default async function UseTemplatePage({ params }: PageProps) {
  const { slug } = await params
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

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
  const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'

  // Get user's workspaces
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: session.user.id },
      status: { equals: 'active' },
    },
    depth: 1,
    limit: 100,
  })

  const workspaces = memberships.docs
    .map((m) => {
      const ws = typeof m.workspace === 'object' ? m.workspace : null
      if (!ws) return null
      return { id: String(ws.id), name: ws.name }
    })
    .filter((ws): ws is { id: string; name: string } => ws !== null)

  // Get GitHub health status and available orgs
  const firstWorkspaceId = workspaces[0]?.id
  const githubHealth = firstWorkspaceId
    ? await getGitHubHealth(firstWorkspaceId)
    : { healthy: true, installations: [], availableOrgs: [] }

  const githubOrgs = githubHealth.availableOrgs.map((org) => ({
    login: org.name,
    name: org.name,
  }))

  // Parse variables from template
  const variables = (template.variables as Array<{
    key: string
    type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
    required: boolean
    description?: string
    default?: string | number | boolean
    options?: Array<{ label: string; value: string }>
  }>) || []

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          {/* Template Info Header */}
          <div className="max-w-2xl mx-auto mb-8">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{emoji}</span>
                  <div>
                    <CardTitle>Use {template.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <span>{template.language}</span>
                      {template.framework && (
                        <>
                          <span>•</span>
                          <span>{template.framework}</span>
                        </>
                      )}
                      {template.complexity && (
                        <>
                          <span>•</span>
                          <Badge variant="outline">{template.complexity}</Badge>
                        </>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              {template.description && (
                <CardContent>
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                </CardContent>
              )}
            </Card>
          </div>

          {/* Form */}
          <UseTemplateForm
            templateId={String(template.id)}
            templateName={template.name}
            variables={variables}
            workspaces={workspaces}
            githubOrgs={githubOrgs}
            githubInstallations={githubHealth.installations}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
