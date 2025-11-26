'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LayoutTemplate, Plus, ArrowRight, Lock, Globe, Users, GitBranch } from 'lucide-react'
import Link from 'next/link'

interface WorkspaceTemplate {
  id: string
  name: string
  slug: string
  description?: string
  language?: string
  framework?: string
  visibility: 'workspace' | 'shared' | 'public'
  usageCount: number
  categories?: string[]
}

interface WorkspaceTemplatesSectionProps {
  workspaceSlug: string
  workspaceId: string
  templates: WorkspaceTemplate[]
  canManage: boolean
}

const visibilityIcons = {
  workspace: Lock,
  shared: Users,
  public: Globe,
}

const visibilityLabels = {
  workspace: 'Workspace Only',
  shared: 'Shared',
  public: 'Public',
}

const languageEmoji: Record<string, string> = {
  typescript: '🔷',
  javascript: '🟨',
  go: '🔵',
  python: '🐍',
  rust: '🦀',
  java: '☕',
  ruby: '💎',
  kubernetes: '☸️',
  terraform: '🏗️',
  ansible: '🔧',
  helm: '⎈',
  docker: '🐳',
}

export function WorkspaceTemplatesSection({
  workspaceSlug,
  workspaceId,
  templates,
  canManage,
}: WorkspaceTemplatesSectionProps) {
  if (templates.length === 0 && !canManage) {
    // Don't show section if user can't create templates and there are none
    return null
  }

  if (templates.length === 0 && canManage) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5" />
            <CardTitle>Templates</CardTitle>
          </div>
          <CardDescription>
            No templates yet. Import a GitHub repository to create your first template.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/templates/import?workspace=${workspaceId}`}>
            <Button className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Import Template
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-6 w-6" />
          <h2 className="text-2xl font-bold">Templates</h2>
        </div>
        {canManage && (
          <Link href={`/templates/import?workspace=${workspaceId}`}>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Import Template
            </Button>
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.slice(0, 6).map((template) => {
          const VisibilityIcon = visibilityIcons[template.visibility]
          const emoji = languageEmoji[template.language?.toLowerCase() || ''] || '📦'

          return (
            <Link
              key={template.id}
              href={`/templates/${template.slug}`}
            >
              <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                      {template.description && (
                        <CardDescription className="mt-1 line-clamp-2">
                          {template.description}
                        </CardDescription>
                      )}
                    </div>
                    <div className="ml-2 text-2xl">{emoji}</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Language & Framework */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {template.language && (
                      <Badge variant="secondary" className="text-xs">
                        {template.language}
                      </Badge>
                    )}
                    {template.framework && (
                      <Badge variant="outline" className="text-xs">
                        {template.framework}
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{template.usageCount}</span>
                      <span className="text-muted-foreground">
                        {template.usageCount === 1 ? 'use' : 'uses'}
                      </span>
                    </div>
                  </div>

                  {/* Visibility */}
                  <div className="flex items-center gap-2">
                    <VisibilityIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {visibilityLabels[template.visibility]}
                    </span>
                  </div>

                  {/* View button */}
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-sm font-medium text-primary">
                      <span>View Template</span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* View all link */}
      <div className="flex justify-center">
        <Link href={`/templates?workspace=${workspaceId}`}>
          <Button variant="outline">
            <LayoutTemplate className="h-4 w-4 mr-2" />
            View All Templates
          </Button>
        </Link>
      </div>
    </div>
  )
}
