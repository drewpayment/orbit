'use client'

import { useState } from 'react'
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
import { cn } from '@/lib/utils'

import { createUser } from './actions'
import { canAssignRole, type UserRole } from './policy'

const ROLE_LABELS: Record<UserRole, string> = {
  user: 'User',
  admin: 'Admin',
  super_admin: 'Super Admin',
}

type CredentialMode = 'invite' | 'password'

interface CreateUserDialogProps {
  actorRole: UserRole
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateUserDialog({ actorRole, open, onOpenChange, onCreated }: CreateUserDialogProps) {
  const assignableRoles = (['user', 'admin', 'super_admin'] as UserRole[]).filter((r) =>
    canAssignRole(actorRole, r),
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [mode, setMode] = useState<CredentialMode>('invite')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName('')
    setEmail('')
    setRole('user')
    setMode('invite')
    setPassword('')
    setConfirm('')
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async () => {
    setError(null)

    if (!name.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }
    if (mode === 'password') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters')
        return
      }
      if (password !== confirm) {
        setError('Passwords do not match')
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await createUser({
        name: name.trim(),
        email: email.trim(),
        role,
        mode,
        password: mode === 'password' ? password : undefined,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success('User created', {
        description:
          mode === 'invite'
            ? `Invite email sent to ${email.trim()}.`
            : `${name.trim()} can sign in with the password you set.`,
      })
      reset()
      onOpenChange(false)
      onCreated()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Add a new platform user. Send them an invite to set their own password, or set one
            manually for environments without email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="create-user-name">Name</Label>
            <Input
              id="create-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-user-email">Email</Label>
            <Input
              id="create-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ada@example.com"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-user-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="create-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Credentials</Label>
            <div className="grid grid-cols-2 gap-2">
              <ModeOption
                active={mode === 'invite'}
                title="Send invite email"
                subtitle="User sets their own password"
                onClick={() => setMode('invite')}
              />
              <ModeOption
                active={mode === 'password'}
                title="Set password manually"
                subtitle="Account is verified immediately"
                onClick={() => setMode('password')}
              />
            </div>
          </div>

          {mode === 'password' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="create-user-password">Password</Label>
                <Input
                  id="create-user-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-user-confirm">Confirm</Label>
                <Input
                  id="create-user-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeOption({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-input hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground">{subtitle}</span>
    </button>
  )
}
