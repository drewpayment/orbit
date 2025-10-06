'use client'

import { useState } from 'react'
import { Plus, Settings, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkspaceList } from './WorkspaceList'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog'
import { MemberManagementDialog } from './MemberManagementDialog'

export interface Workspace {
  id: string
  name: string
  slug: string
  description?: string
  settings: WorkspaceSettings
  created_at: Date
  updated_at: Date
  created_by: string
  memberCount?: number
  repositoryCount?: number
}

export interface WorkspaceSettings {
  default_visibility: 'private' | 'internal' | 'public'
  require_approval_for_repos: boolean
  enable_code_generation: boolean
  allowed_template_types: string[]
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  user_email: string
  user_name: string
  user_avatar?: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  joined_at: Date
}

export function WorkspaceManager() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false)
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false)

  const handleWorkspaceSelect = (workspace: Workspace) => {
    setSelectedWorkspace(workspace)
  }

  const handleOpenSettings = () => {
    if (selectedWorkspace) {
      setIsSettingsDialogOpen(true)
    }
  }

  const handleOpenMembers = () => {
    if (selectedWorkspace) {
      setIsMembersDialogOpen(true)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-2xl font-bold">Workspaces</h1>
            <p className="text-sm text-muted-foreground">
              Manage your team workspaces and members
            </p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Workspace
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Workspace List */}
        <div className="flex-1 overflow-y-auto p-6">
          <WorkspaceList
            onWorkspaceSelect={handleWorkspaceSelect}
            selectedWorkspaceId={selectedWorkspace?.id}
          />
        </div>

        {/* Workspace Actions Sidebar */}
        {selectedWorkspace && (
          <div className="w-80 border-l bg-muted/10 p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{selectedWorkspace.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedWorkspace.description || 'No description'}
                </p>
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleOpenSettings}
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Workspace Settings
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleOpenMembers}
                >
                  <Users className="mr-2 h-4 w-4" />
                  Manage Members
                </Button>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-2 text-sm font-medium">Quick Stats</h3>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Members:</span>
                    <span className="font-medium text-foreground">
                      {selectedWorkspace.memberCount || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Repositories:</span>
                    <span className="font-medium text-foreground">
                      {selectedWorkspace.repositoryCount || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateWorkspaceDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />

      {selectedWorkspace && (
        <>
          <WorkspaceSettingsDialog
            workspace={selectedWorkspace}
            open={isSettingsDialogOpen}
            onOpenChange={setIsSettingsDialogOpen}
          />
          <MemberManagementDialog
            workspace={selectedWorkspace}
            open={isMembersDialogOpen}
            onOpenChange={setIsMembersDialogOpen}
          />
        </>
      )}
    </div>
  )
}
