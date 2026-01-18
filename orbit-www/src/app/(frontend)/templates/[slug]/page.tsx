// orbit-www/src/app/(frontend)/templates/[slug]/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ExternalLink,
  GitBranch,
  Users,
  AlertCircle,
  CheckCircle2,
  Settings,
} from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { TemplateSyncStatus } from '@/components/features/templates/TemplateSyncStatus'

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

const complexityColors: Record<string, string> = {
  starter: 'bg-green-100 text-green-800',
  intermediate: 'bg-yellow-100 text-yellow-800',
  'production-ready': 'bg-blue-100 text-blue-800',
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { slug } = await params

  // Phase 1: Parallelize initial setup
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user) {
    notFound()
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
  const tags = (template.tags as Array<{ tag: string }> | undefined) || []
  const variables = (template.variables as Array<{
    key: string
    type: string
    required: boolean
    description?: string
    default?: string | number | boolean
  }>) || []
  const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'

  // Check if user can edit this template
  const workspaceId = typeof template.workspace === 'string'
    ? template.workspace
    : template.workspace.id

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

  const canEdit = membership.docs.length > 0

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <span className="text-5xl">{emoji}</span>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">{template.name}</h1>
                  <div className="flex items-center gap-2 mt-2 text-muted-foreground">
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
                        <Badge className={complexityColors[template.complexity]}>
                          {template.complexity}
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {canEdit && (
                  <Button variant="outline" asChild>
                    <Link href={`/templates/${slug}/edit`}>
                      <Settings className="mr-2 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                )}
                <Button size="lg" asChild>
                  <Link href={`/templates/${slug}/use`}>
                    Use Template
                  </Link>
                </Button>
              </div>
            </div>

            {/* Description */}
            {template.description && (
              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap">{template.description}</p>
                </CardContent>
              </Card>
            )}

            {/* Metadata */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Source Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Source Repository</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Repository</span>
                    <a
                      href={template.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      View on GitHub
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Branch</span>
                    <div className="flex items-center gap-1">
                      <GitBranch className="h-4 w-4" />
                      <span>{template.defaultBranch}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">GitHub Template</span>
                    {template.isGitHubTemplate ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Yes
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        No
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Stats */}
              <Card>
                <CardHeader>
                  <CardTitle>Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Usage Count</span>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{template.usageCount || 0} repositories</span>
                    </div>
                  </div>
                  <div className="pt-4 border-t">
                    <TemplateSyncStatus
                      templateId={template.id as string}
                      syncStatus={template.syncStatus ?? 'pending'}
                      syncError={template.syncError}
                      lastSyncedAt={template.lastSyncedAt}
                      canSync={canEdit}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t, i) => (
                      <Badge key={i} variant="outline">
                        {t.tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Variables */}
            {variables.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Template Variables</CardTitle>
                  <CardDescription>
                    These variables will be requested when using this template
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {variables.map((v, i) => (
                      <div key={i} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <code className="font-mono text-sm bg-muted px-2 py-1 rounded">
                            {'{{'}{v.key}{'}}'}
                          </code>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{v.type}</Badge>
                            {v.required && (
                              <Badge variant="secondary" className="bg-red-100 text-red-800">
                                Required
                              </Badge>
                            )}
                          </div>
                        </div>
                        {v.description && (
                          <p className="text-sm text-muted-foreground">{v.description}</p>
                        )}
                        {v.default !== undefined && (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">Default:</span>{' '}
                            <code className="font-mono bg-muted px-1 rounded">
                              {String(v.default)}
                            </code>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
