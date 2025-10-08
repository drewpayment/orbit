'use client'

import { useState, useEffect, useCallback } from 'react'
import { UserPlus, Loader2, MoreVertical, Mail } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import type { Workspace } from './WorkspaceManager'
import {
  getWorkspaceMembers,
  inviteWorkspaceMember,
  updateMemberRole,
  removeMember,
} from '@/app/(frontend)/workspaces/actions'

interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
  userEmail: string
  userName: string
  userAvatar?: string | null
  role: 'owner' | 'admin' | 'member'
  status: string
  joinedAt: string
}

interface MemberManagementDialogProps {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MemberManagementDialog({
  workspace,
  open,
  onOpenChange,
}: MemberManagementDialogProps) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceMember['role']>('member')
  const [isInviting, setIsInviting] = useState(false)

  const loadMembers = useCallback(async () => {
    try {
      setIsLoading(true)
      const result = await getWorkspaceMembers(workspace.id)
      
      if (result.success) {
        setMembers(result.members)
      } else {
        toast.error('Failed to load members', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to load members', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    if (open) {
      loadMembers()
    }
  }, [open, loadMembers])

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.error('Email required', {
        description: 'Please enter an email address',
      })
      return
    }

    try {
      setIsInviting(true)
      const result = await inviteWorkspaceMember(workspace.id, inviteEmail, inviteRole)

      if (result.success) {
        toast.success('Member added', {
          description: `Added ${inviteEmail} as ${inviteRole}`,
        })
        setInviteEmail('')
        setInviteRole('member')
        loadMembers()
      } else {
        toast.error('Failed to add member', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to add member', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsInviting(false)
    }
  }

  const handleChangeRole = async (memberId: string, newRole: WorkspaceMember['role']) => {
    try {
      const result = await updateMemberRole(memberId, newRole)

      if (result.success) {
        toast.success('Role updated', {
          description: 'Member role has been changed successfully',
        })
        loadMembers()
      } else {
        toast.error('Failed to update role', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to update role', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this member from the workspace?')) {
      return
    }

    try {
      const result = await removeMember(memberId)

      if (result.success) {
        toast.success('Member removed', {
          description: 'Member has been removed from the workspace',
        })
        loadMembers()
      } else {
        toast.error('Failed to remove member', {
          description: result.error || 'An unexpected error occurred',
        })
      }
    } catch (error) {
      toast.error('Failed to remove member', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    }
  }

  const getRoleBadgeVariant = (role: WorkspaceMember['role']) => {
    switch (role) {
      case 'owner':
        return 'default'
      case 'admin':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Manage Members</DialogTitle>
          <DialogDescription>
            Invite members and manage their roles in {workspace.name}
          </DialogDescription>
        </DialogHeader>

        {/* Invite Section */}
        <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
          <h4 className="text-sm font-medium">Invite Member</h4>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleInvite()
                  }
                }}
              />
            </div>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as WorkspaceMember['role'])}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleInvite} disabled={isInviting}>
              {isInviting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              Invite
            </Button>
          </div>
        </div>

        {/* Members List */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">
            Members ({members.length})
          </h4>

          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.userAvatar || undefined} />
                            <AvatarFallback>{getInitials(member.userName)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{member.userName}</p>
                            <p className="text-xs text-muted-foreground">{member.userEmail}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {member.role !== 'owner' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleChangeRole(member.id, 'admin')}>
                                Change to Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleChangeRole(member.id, 'member')}>
                                Change to Member
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleRemoveMember(member.id)}
                                className="text-destructive"
                              >
                                Remove from workspace
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
