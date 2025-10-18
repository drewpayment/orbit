'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookOpen, Plus, FileText, ArrowRight, Lock, Globe, Users } from 'lucide-react'
import Link from 'next/link'

interface KnowledgeSpace {
  id: string
  name: string
  slug: string
  description?: string
  icon?: string
  visibility: 'private' | 'internal' | 'public'
  pageCount: number
  publishedCount: number
  draftCount: number
}

interface WorkspaceKnowledgeSectionProps {
  workspaceSlug: string
  spaces: KnowledgeSpace[]
  canManage: boolean
}

const visibilityIcons = {
  private: Lock,
  internal: Users,
  public: Globe,
}

const visibilityLabels = {
  private: 'Private',
  internal: 'Internal',
  public: 'Public',
}

export function WorkspaceKnowledgeSection({
  workspaceSlug,
  spaces,
  canManage,
}: WorkspaceKnowledgeSectionProps) {
  if (spaces.length === 0 && !canManage) {
    // Don't show section if user can't create spaces and there are none
    return null
  }

  if (spaces.length === 0 && canManage) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            <CardTitle>Knowledge Spaces</CardTitle>
          </div>
          <CardDescription>
            No knowledge spaces yet. Create your first space to start organizing documentation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/workspaces/${workspaceSlug}/knowledge/new`}>
            <Button className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Create Knowledge Space
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
          <BookOpen className="h-6 w-6" />
          <h2 className="text-2xl font-bold">Knowledge Spaces</h2>
        </div>
        {canManage && (
          <Link href={`/workspaces/${workspaceSlug}/knowledge/new`}>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Space
            </Button>
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((space) => {
          const VisibilityIcon = visibilityIcons[space.visibility]

          return (
            <Link
              key={space.id}
              href={`/workspaces/${workspaceSlug}/knowledge/${space.slug}`}
            >
              <Card className="h-full transition-all hover:border-primary hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{space.name}</CardTitle>
                      {space.description && (
                        <CardDescription className="mt-1 line-clamp-2">
                          {space.description}
                        </CardDescription>
                      )}
                    </div>
                    {space.icon && (
                      <div className="ml-2 text-2xl">{space.icon}</div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{space.pageCount}</span>
                      <span className="text-muted-foreground">
                        {space.pageCount === 1 ? 'page' : 'pages'}
                      </span>
                    </div>
                    {space.publishedCount > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-green-600">
                          {space.publishedCount}
                        </span>
                        <span className="text-muted-foreground text-xs">published</span>
                      </div>
                    )}
                  </div>

                  {/* Visibility */}
                  <div className="flex items-center gap-2">
                    <VisibilityIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {visibilityLabels[space.visibility]}
                    </span>
                  </div>

                  {/* View button */}
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-sm font-medium text-primary">
                      <span>View Pages</span>
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
        <Link href={`/workspaces/${workspaceSlug}/knowledge`}>
          <Button variant="outline">
            <BookOpen className="h-4 w-4 mr-2" />
            View All Knowledge Spaces
          </Button>
        </Link>
      </div>
    </div>
  )
}
