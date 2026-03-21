'use client'

import { useEffect, useState } from 'react'
import { Building2, Users, GitBranch } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Workspace } from './WorkspaceManager'
import { cn } from '@/lib/utils'

interface WorkspaceListProps {
  initialWorkspaces?: Workspace[]
  onWorkspaceSelect?: (workspace: Workspace) => void
  selectedWorkspaceId?: string
}

export function WorkspaceList({
  initialWorkspaces = [],
  onWorkspaceSelect,
  selectedWorkspaceId
}: WorkspaceListProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces)

  useEffect(() => {
    setWorkspaces(initialWorkspaces)
  }, [initialWorkspaces])

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
