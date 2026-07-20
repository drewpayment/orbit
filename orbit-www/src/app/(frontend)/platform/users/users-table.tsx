'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Mail,
  MailWarning,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

import { canManageTarget, type ActionResult, type UserRole } from './policy'
import {
  approveUser,
  deactivateUser,
  reactivateUser,
  rejectUser,
  resendInvite,
  resendVerification,
  sendPasswordReset,
} from './actions'
import { CreateUserDialog } from './create-user-dialog'
import { EditUserDialog } from './edit-user-dialog'

export type UserStatus = 'pending' | 'approved' | 'rejected' | 'deactivated'

export interface UserRow {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  emailVerified: boolean
  avatarUrl: string | null
  createdAt: string
  // Set when the account was created via an admin invite link; distinguishes
  // invited users (show "Resend invite") from self-registered ones ("Resend
  // verification"). null for self-registered / pre-existing users.
  invitedAt: string | null
}

interface UsersTableProps {
  users: UserRow[]
  actorId: string
  actorRole: UserRole
}

const ROLE_LABELS: Record<UserRole, string> = {
  user: 'User',
  admin: 'Admin',
  super_admin: 'Super Admin',
}

const STATUS_STYLES: Record<UserStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
  rejected: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900',
  deactivated: 'bg-muted text-muted-foreground border-border',
}

const STATUS_LABELS: Record<UserStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  deactivated: 'Deactivated',
}

function getInitials(name: string, email: string): string {
  const source = name.trim() || email
  return source
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}

export function UsersTable({ users, actorId, actorRole }: UsersTableProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null)

  const pendingCount = useMemo(() => users.filter((u) => u.status === 'pending').length, [users])
  const deactivatedCount = useMemo(
    () => users.filter((u) => u.status === 'deactivated').length,
    [users],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter !== 'all' && u.status !== statusFilter) return false
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false
      return true
    })
  }, [users, search, roleFilter, statusFilter])

  const runAction = (label: string, fn: () => Promise<ActionResult>) => {
    startTransition(async () => {
      try {
        const res = await fn()
        if (!res.ok) {
          toast.error(label + ' failed', { description: res.error })
          return
        }
        toast.success(label)
        router.refresh()
      } catch {
        toast.error(label + ' failed', { description: 'Something went wrong.' })
      }
    })
  }

  const confirmDeactivate = () => {
    if (!deactivateTarget) return
    const target = deactivateTarget
    setDeactivateTarget(null)
    runAction('User deactivated', () => deactivateUser(target.id))
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Create platform users, manage their roles, and review registration requests. Every
            action is enforced server-side against the platform role policy.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Create user
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Total users" value={users.length} />
        <SummaryTile
          label="Pending approval"
          value={pendingCount}
          highlight={pendingCount > 0}
        />
        <SummaryTile label="Deactivated" value={deactivatedCount} muted />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | 'all')}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="super_admin">Super Admin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UserStatus | 'all')}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="deactivated">Deactivated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  {users.length === 0
                    ? 'No users yet.'
                    : 'No users match your search and filters.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => (
                <UserTableRow
                  key={u.id}
                  user={u}
                  actorId={actorId}
                  actorRole={actorRole}
                  pending={pending}
                  onEdit={() => setEditTarget(u)}
                  onDeactivate={() => setDeactivateTarget(u)}
                  runAction={runAction}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog
        actorRole={actorRole}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => router.refresh()}
      />

      <EditUserDialog
        user={editTarget}
        actorId={actorId}
        actorRole={actorRole}
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
        onSaved={() => router.refresh()}
      />

      <AlertDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.name || deactivateTarget?.email} will be signed out everywhere and
              blocked from signing in until reactivated. This does not delete their account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  highlight,
  muted,
}: {
  label: string
  value: number
  highlight?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        highlight && 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold',
          highlight && 'text-amber-700 dark:text-amber-300',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

interface RowProps {
  user: UserRow
  actorId: string
  actorRole: UserRole
  pending: boolean
  onEdit: () => void
  onDeactivate: () => void
  runAction: (label: string, fn: () => Promise<ActionResult>) => void
}

function UserTableRow({ user, actorId, actorRole, pending, onEdit, onDeactivate, runAction }: RowProps) {
  const canManage = canManageTarget(actorRole, user.role)
  const isSelf = user.id === actorId

  const canEdit = canManage
  const canApproveReject = canManage && user.status === 'pending'
  const approvedUnverified = canManage && user.status === 'approved' && !user.emailVerified
  // An invited user finishes via the invite link (Resend invite); a
  // self-registered user via the verification email (Resend verification).
  // The server actions enforce the same split, so only one shows per row.
  const canResendInvite = approvedUnverified && Boolean(user.invitedAt)
  const canResendVerification = approvedUnverified && !user.invitedAt
  const canPasswordReset = canManage && user.status === 'approved' && user.emailVerified
  const canDeactivate = canManage && !isSelf && user.status === 'approved'
  const canReactivate = canManage && user.status === 'deactivated'

  const hasAnyAction =
    canEdit ||
    canApproveReject ||
    canResendInvite ||
    canResendVerification ||
    canPasswordReset ||
    canDeactivate ||
    canReactivate

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatarUrl || undefined} />
            <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{user.name || '—'}</span>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
      <TableCell>
        <Badge variant={user.role === 'user' ? 'outline' : 'secondary'} className="gap-1">
          {user.role !== 'user' && <ShieldCheck className="h-3 w-3" />}
          {ROLE_LABELS[user.role]}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn('border', STATUS_STYLES[user.status])}>
          {STATUS_LABELS[user.status]}
        </Badge>
      </TableCell>
      <TableCell>
        {user.emailVerified ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <BadgeCheck className="h-4 w-4" />
            <span className="sr-only">Verified</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MailWarning className="h-4 w-4" />
            <span className="sr-only">Unverified</span>
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {new Date(user.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell>
        {hasAnyAction ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending}>
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {canEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}
              {canApproveReject && (
                <>
                  <DropdownMenuItem
                    onClick={() => runAction('User approved', () => approveUser(user.id))}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Approve
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => runAction('User rejected', () => rejectUser(user.id))}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </DropdownMenuItem>
                </>
              )}
              {canResendVerification && (
                <DropdownMenuItem
                  onClick={() =>
                    runAction('Verification email sent', () => resendVerification(user.id))
                  }
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Resend verification
                </DropdownMenuItem>
              )}
              {canResendInvite && (
                <DropdownMenuItem
                  onClick={() => runAction('Invite email sent', () => resendInvite(user.id))}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Resend invite
                </DropdownMenuItem>
              )}
              {canPasswordReset && (
                <DropdownMenuItem
                  onClick={() =>
                    runAction('Password reset email sent', () => sendPasswordReset(user.id))
                  }
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Send password reset
                </DropdownMenuItem>
              )}
              {canReactivate && (
                <DropdownMenuItem
                  onClick={() => runAction('User reactivated', () => reactivateUser(user.id))}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reactivate
                </DropdownMenuItem>
              )}
              {canDeactivate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDeactivate} className="text-destructive">
                    <Ban className="mr-2 h-4 w-4" />
                    Deactivate
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground/40">
            <X className="h-4 w-4" />
            <span className="sr-only">No actions available</span>
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}
