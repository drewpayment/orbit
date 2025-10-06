'use client'

import { useState, useEffect } from 'react'
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
import type { Workspace, WorkspaceMember } from './WorkspaceManager'

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

  useEffect(() => {
    if (open) {
      loadMembers()
    }
  }, [open, workspace.id])

  const loadMembers = async () => {
    try {
      setIsLoading(true)

      // TODO: Replace with actual gRPC client call
      await new Promise(resolve => setTimeout(resolve, 800))

      const mockMembers: WorkspaceMember[] = [
        {
          workspace_id: workspace.id,
          user_id: 'user-1',
          user_email: 'alice@example.com',
          user_name: 'Alice Johnson',
          user_avatar: undefined,
          role: 'owner',
          joined_at: new Date('2024-01-15'),
        },
        {
          workspace_id: workspace.id,
          user_id: 'user-2',
          user_email: 'bob@example.com',
          user_name: 'Bob Smith',
          user_avatar: undefined,
          role: 'admin',
          joined_at: new Date('2024-02-01'),
        },
        {
          workspace_id: workspace.id,
          user_id: 'user-3',
          user_email: 'charlie@example.com',
          user_name: 'Charlie Brown',
          user_avatar: undefined,
          role: 'member',
          joined_at: new Date('2024-03-10'),
        },
      ]

      setMembers(mockMembers)
    } catch (error) {
      toast.error('Failed to load members', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.error('Email required', {
        description: 'Please enter an email address',
      })
      return
    }

    try {
      setIsInviting(true)

      // TODO: Replace with actual gRPC client call
      await new Promise(resolve => setTimeout(resolve, 1000))

      toast.success('Invitation sent', {
        description: `Invited ${inviteEmail} as ${inviteRole}`,
      })

      setInviteEmail('')
      setInviteRole('member')
      loadMembers()
    } catch (error) {
      toast.error('Failed to send invitation', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      })
    } finally {
      setIsInviting(false)
    }
  }

  const handleChangeRole = async (memberId: string, newRole: WorkspaceMember['role']) => {
    try {
      // TODO: Replace with actual gRPC client call
      await new Promise(resolve => setTimeout(resolve, 500))

      toast.success('Role updated', {
        description: 'Member role has been changed successfully',
      })

      loadMembers()
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
      // TODO: Replace with actual gRPC client call
      await new Promise(resolve => setTimeout(resolve, 500))

      toast.success('Member removed', {
        description: 'Member has been removed from the workspace',
      })

      loadMembers()
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
                <SelectItem value="viewer">Viewer</SelectItem>
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
                    <TableRow key={member.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={member.user_avatar} />
                            <AvatarFallback>{getInitials(member.user_name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{member.user_name}</p>
                            <p className="text-xs text-muted-foreground">{member.user_email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(member.joined_at).toLocaleDateString()}
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
                              <DropdownMenuItem onClick={() => handleChangeRole(member.user_id, 'admin')}>
                                Change to Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleChangeRole(member.user_id, 'member')}>
                                Change to Member
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleChangeRole(member.user_id, 'viewer')}>
                                Change to Viewer
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleRemoveMember(member.user_id)}
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
