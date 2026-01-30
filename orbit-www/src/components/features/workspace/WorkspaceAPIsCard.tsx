import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileCode, Plus, Globe, Lock, Users } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface APISchema {
  id: string
  name: string
  description?: string | null
  currentVersion?: string | null
  status?: 'draft' | 'published' | 'deprecated' | null
  visibility?: 'private' | 'workspace' | 'public' | null
  updatedAt: string
}

interface WorkspaceAPIsCardProps {
  apis: APISchema[]
  workspaceSlug: string
}

const statusConfig = {
  draft: { label: 'Draft', className: 'bg-yellow-100 text-yellow-800' },
  published: { label: 'Published', className: 'bg-green-100 text-green-800' },
  deprecated: { label: 'Deprecated', className: 'bg-red-100 text-red-800' },
} as const

const visibilityIcons = {
  private: Lock,
  workspace: Users,
  public: Globe,
} as const

export function WorkspaceAPIsCard({
  apis,
  workspaceSlug,
}: WorkspaceAPIsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link
            href={`/workspaces/${workspaceSlug}/apis`}
            className="flex items-center gap-2 hover:text-foreground/80 transition-colors"
          >
            <FileCode className="h-5 w-5" />
            <CardTitle className="text-base">API Specifications</CardTitle>
          </Link>
          <Button size="sm" className="bg-blue-500 hover:bg-blue-600" asChild>
            <Link href={`/workspaces/${workspaceSlug}/apis/new`}>
              <Plus className="h-4 w-4 mr-1" />
              New API
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {apis.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No API specifications yet</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/workspaces/${workspaceSlug}/apis/new`}>
                Create your first API
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
              <span>Name</span>
              <span>Updated</span>
              <span></span>
            </div>
            {/* API rows */}
            {apis.slice(0, 5).map((api) => {
              const status = api.status || 'draft'
              const visibility = api.visibility || 'workspace'
              const config = statusConfig[status]
              const VisibilityIcon = visibilityIcons[visibility]

              return (
                <div
                  key={api.id}
                  className="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-2 py-3 rounded-lg hover:bg-muted/50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{api.name}</p>
                      {api.currentVersion && (
                        <Badge variant="outline" className="text-xs font-mono">
                          {api.currentVersion}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge className={`text-xs ${config.className}`}>
                        {config.label}
                      </Badge>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <VisibilityIcon className="h-3 w-3" />
                        <span className="text-xs capitalize">{visibility}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(api.updatedAt), { addSuffix: true })}
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/catalog/apis/${api.id}`}>
                      View
                    </Link>
                  </Button>
                </div>
              )
            })}
            {apis.length > 5 && (
              <div className="pt-2 text-center">
                <Button variant="link" size="sm" asChild>
                  <Link href={`/workspaces/${workspaceSlug}/apis`}>
                    View all {apis.length} APIs →
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
