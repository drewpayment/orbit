'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft,
  Edit,
  Trash2,
  Globe,
  Lock,
  Users,
  Mail,
  User,
  Server,
  Tag,
  Clock,
  FileCode,
  History,
  Loader2,
} from 'lucide-react'
import { SwaggerUIViewer } from '@/components/features/api-catalog/SwaggerUIViewer'
import { VersionHistory } from '@/components/features/api-catalog/VersionHistory'
import { deleteAPISchema } from '@/app/(frontend)/workspaces/[slug]/apis/actions'
import { toast } from 'sonner'
import { formatDistanceToNow, format } from 'date-fns'
import type { APISchema, APISchemaVersion } from '@/types/api-catalog'

// Dynamically import Monaco Editor for raw schema view
const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-muted animate-pulse rounded-md flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  ),
})

interface APIDetailClientProps {
  api: APISchema
  versions: APISchemaVersion[]
  canEdit: boolean
  userId?: string
}

const visibilityConfig = {
  private: { icon: Lock, label: 'Private', color: 'text-yellow-600' },
  workspace: { icon: Users, label: 'Workspace', color: 'text-blue-600' },
  public: { icon: Globe, label: 'Public', color: 'text-green-600' },
}

const statusConfig = {
  draft: { label: 'Draft', className: 'bg-yellow-100 text-yellow-800' },
  published: { label: 'Published', className: 'bg-green-100 text-green-800' },
  deprecated: { label: 'Deprecated', className: 'bg-red-100 text-red-800' },
}

export function APIDetailClient({ api, versions, canEdit, userId }: APIDetailClientProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [selectedVersionContent, setSelectedVersionContent] = React.useState<string | null>(null)

  const workspaceSlug = typeof api.workspace === 'object' ? api.workspace.slug : ''
  const workspaceName = typeof api.workspace === 'object' ? api.workspace.name : ''
  const visibility = (api.visibility || 'workspace') as 'private' | 'workspace' | 'public'
  const status = (api.status || 'draft') as 'draft' | 'published' | 'deprecated'
  const VisibilityIcon = visibilityConfig[visibility].icon

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteAPISchema(api.id)
      toast.success('API deleted successfully')
      router.push('/catalog/apis')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete API')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleViewVersion = (content: string) => {
    setSelectedVersionContent(content)
  }

  const displayContent = selectedVersionContent || api.rawContent || ''

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/catalog/apis"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Catalog
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{api.name}</h1>
            {api.currentVersion && (
              <Badge variant="outline" className="text-sm">
                {api.currentVersion}
              </Badge>
            )}
            <Badge className={statusConfig[status].className}>
              {statusConfig[status].label}
            </Badge>
          </div>
          {workspaceName && (
            <Link
              href={`/workspaces/${workspaceSlug}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {workspaceName}
            </Link>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className={`flex items-center gap-1 ${visibilityConfig[visibility].color}`}>
              <VisibilityIcon className="h-4 w-4" />
              {visibilityConfig[visibility].label}
            </div>
            {api.endpointCount !== undefined && (
              <div className="flex items-center gap-1">
                <FileCode className="h-4 w-4" />
                {api.endpointCount} endpoint{api.endpointCount !== 1 ? 's' : ''}
              </div>
            )}
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Updated {formatDistanceToNow(new Date(api.updatedAt), { addSuffix: true })}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/workspaces/${workspaceSlug}/apis/${api.id}`}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete API?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &quot;{api.name}&quot; and all its versions.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Version viewing notice */}
      {selectedVersionContent && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center justify-between">
          <span className="text-sm text-yellow-800 dark:text-yellow-200">
            Viewing historical version. Documentation and raw schema show this version.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedVersionContent(null)}
          >
            View Current
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="documentation" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documentation">Documentation</TabsTrigger>
          <TabsTrigger value="versions">
            <History className="h-4 w-4 mr-1" />
            Versions ({versions.length})
          </TabsTrigger>
          <TabsTrigger value="raw">Raw Schema</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(api.description || api.specDescription) && (
                <div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {api.description || api.specDescription}
                  </p>
                </div>
              )}

              {api.tags && api.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <Tag className="h-4 w-4" />
                    Tags
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {api.tags.map((t: { tag: string }) => (
                      <Badge key={t.tag} variant="secondary">
                        {t.tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                {(api.contactName || api.contactEmail) && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Contact</h4>
                    <div className="space-y-1">
                      {api.contactName && (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4 text-muted-foreground" />
                          {api.contactName}
                        </div>
                      )}
                      {api.contactEmail && (
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <a
                            href={`mailto:${api.contactEmail}`}
                            className="text-primary hover:underline"
                          >
                            {api.contactEmail}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {api.serverUrls && api.serverUrls.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                      <Server className="h-4 w-4" />
                      Servers
                    </h4>
                    <div className="space-y-1">
                      {api.serverUrls.map((s: { url: string }, i: number) => (
                        <code key={i} className="text-xs block bg-muted px-2 py-1 rounded">
                          {s.url}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div className="text-xs text-muted-foreground space-y-1">
                <p>Created: {format(new Date(api.createdAt), 'PPP')}</p>
                <p>Last updated: {format(new Date(api.updatedAt), 'PPP')}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documentation Tab */}
        <TabsContent value="documentation">
          <Card>
            <CardHeader>
              <CardTitle>API Documentation</CardTitle>
              <CardDescription>
                Interactive documentation generated from the OpenAPI specification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SwaggerUIViewer
                spec={displayContent}
                version={selectedVersionContent ? 'Historical Version' : api.currentVersion}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Versions Tab */}
        <TabsContent value="versions">
          <VersionHistory
            versions={versions as React.ComponentProps<typeof VersionHistory>['versions']}
            currentVersionNumber={
              versions.find((v) => v.rawContent === api.rawContent)?.versionNumber
            }
            onViewVersion={handleViewVersion}
            onRestoreVersion={
              canEdit && userId
                ? async (versionId) => {
                    const { restoreVersion } = await import(
                      '@/app/(frontend)/workspaces/[slug]/apis/actions'
                    )
                    await restoreVersion(api.id, versionId, userId)
                    toast.success('Version restored')
                    router.refresh()
                  }
                : undefined
            }
          />
        </TabsContent>

        {/* Raw Schema Tab */}
        <TabsContent value="raw">
          <Card>
            <CardHeader>
              <CardTitle>Raw OpenAPI Specification</CardTitle>
              <CardDescription>
                View the raw YAML content of the specification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-hidden">
                <Editor
                  height="500px"
                  language="yaml"
                  value={displayContent}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
