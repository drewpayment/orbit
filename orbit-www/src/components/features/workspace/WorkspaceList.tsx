'use client'

import { useEffect, useState } from 'react'
import { Building2, Users, GitBranch, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Workspace } from './WorkspaceManager'
import { cn } from '@/lib/utils'

interface WorkspaceListProps {
  onWorkspaceSelect?: (workspace: Workspace) => void
  selectedWorkspaceId?: string
}

export function WorkspaceList({ onWorkspaceSelect, selectedWorkspaceId }: WorkspaceListProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // TODO: Replace with actual gRPC client call
    const fetchWorkspaces = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Mock data for now
        await new Promise(resolve => setTimeout(resolve, 1000))

        const mockWorkspaces: Workspace[] = [
          {
            id: '1',
            name: 'Engineering',
            slug: 'engineering',
            description: 'Main engineering workspace for product development',
            settings: {
              default_visibility: 'internal',
              require_approval_for_repos: true,
              enable_code_generation: true,
              allowed_template_types: ['service', 'library', 'frontend'],
            },
            created_at: new Date('2024-01-15'),
            updated_at: new Date('2024-03-20'),
            created_by: 'user-1',
            memberCount: 12,
            repositoryCount: 45,
          },
          {
            id: '2',
            name: 'Platform',
            slug: 'platform',
            description: 'Infrastructure and platform services',
            settings: {
              default_visibility: 'private',
              require_approval_for_repos: true,
              enable_code_generation: true,
              allowed_template_types: ['service', 'library'],
            },
            created_at: new Date('2024-02-01'),
            updated_at: new Date('2024-03-22'),
            created_by: 'user-2',
            memberCount: 8,
            repositoryCount: 23,
          },
        ]

        setWorkspaces(mockWorkspaces)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workspaces')
      } finally {
        setIsLoading(false)
      }
    }

    fetchWorkspaces()
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading workspaces...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>No Workspaces</CardTitle>
            <CardDescription>
              Get started by creating your first workspace
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {workspaces.map((workspace) => (
        <Card
          key={workspace.id}
          className={cn(
            'cursor-pointer transition-all hover:shadow-md',
            selectedWorkspaceId === workspace.id && 'ring-2 ring-primary'
          )}
          onClick={() => onWorkspaceSelect?.(workspace)}
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{workspace.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">/{workspace.slug}</p>
                </div>
              </div>
              <Badge variant="outline">
                {workspace.settings.default_visibility}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
              {workspace.description || 'No description'}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                <span>{workspace.memberCount || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <GitBranch className="h-4 w-4" />
                <span>{workspace.repositoryCount || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
