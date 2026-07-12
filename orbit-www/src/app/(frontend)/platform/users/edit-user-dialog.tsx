'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { updateUser } from './actions'
import { canAssignRole, type UserRole } from './policy'
import type { UserRow } from './users-table'

const ROLE_LABELS: Record<UserRole, string> = {
  user: 'User',
  admin: 'Admin',
  super_admin: 'Super Admin',
}

interface EditUserDialogProps {
  user: UserRow | null
  actorId: string
  actorRole: UserRole
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function EditUserDialog({
  user,
  actorId,
  actorRole,
  open,
  onOpenChange,
  onSaved,
}: EditUserDialogProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user) {
      setName(user.name)
      setRole(user.role)
      setError(null)
    }
  }, [user])

  if (!user) return null

  const isSelf = user.id === actorId
  // Self may never change their own role. Otherwise the assignable set is the
  // actor's grantable roles plus the target's current role (so a role the actor
  // can't grant is still shown, just not selectable to change into).
  const assignableRoles = (['user', 'admin', 'super_admin'] as UserRole[]).filter(
    (r) => canAssignRole(actorRole, r) || r === user.role,
  )
  // Self may never change their own role, so the select is disabled entirely.
  const roleDisabled = isSelf

  const handleSubmit = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    setSubmitting(true)
    try {
      const res = await updateUser({
        userId: user.id,
        name: name.trim() !== user.name ? name.trim() : undefined,
        role: !isSelf && role !== user.role ? role : undefined,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('User updated')
      onOpenChange(false)
      onSaved()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-user-name">Name</Label>
            <Input
              id="edit-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-user-role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              disabled={roleDisabled}
            >
              <SelectTrigger id="edit-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r} disabled={r !== user.role && !canAssignRole(actorRole, r)}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-xs text-muted-foreground">You cannot change your own role.</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
