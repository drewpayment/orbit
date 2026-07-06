'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, Loader2, RefreshCw, ShieldCheck, User, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { syncInitiative, updateInitiativeStatus } from '@/app/(frontend)/scorecards/initiatives/actions'
import { InitiativeProgressBar } from './InitiativeProgress'
import {
  formatDeadline,
  initiativeStatusPresentation,
  isOverdue,
  targetLevelLabel,
  type InitiativeDetailView,
} from './initiative-ui'

/**
 * Detail-page header for an initiative: title, status badge, target level,
 * scorecard link, deadline (overdue flagged), owner, and the progress bar with
 * counts. Owner/admins additionally get the lifecycle controls (Sync now +
 * Complete/Cancel/Reactivate); those actions are RBAC-enforced server-side and
 * only surface when `canManage` is true.
 */
export function InitiativeHeader({
  initiative,
  canManage,
}: {
  initiative: InitiativeDetailView
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'sync' | 'status'>(null)
  const [confirm, setConfirm] = useState<null | 'completed' | 'cancelled'>(null)

  const status = initiativeStatusPresentation(initiative.status)
  const overdue = initiative.status === 'active' && isOverdue(initiative.deadline, new Date())
  const isActive = initiative.status === 'active'

  async function handleSync() {
    setBusy('sync')
    try {
      const r = await syncInitiative(initiative.id)
      toast.success(
        `Synced: ${r.created} created, ${r.completed} auto-completed, ${r.reopened} reopened.`,
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleStatus(next: 'active' | 'completed' | 'cancelled') {
    setBusy('status')
    try {
      await updateInitiativeStatus(initiative.id, next)
      toast.success(
        next === 'active'
          ? 'Initiative reactivated'
          : next === 'completed'
            ? 'Initiative completed'
            : 'Initiative cancelled',
      )
      setConfirm(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update initiative')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{initiative.name}</h1>
            <Badge variant={status.variant} className={cn('font-normal', status.className)}>
              {status.label}
            </Badge>
          </div>
          {initiative.description && (
            <p className="max-w-2xl text-muted-foreground">{initiative.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <Link
              href={`/scorecards/${initiative.scorecardId}`}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <ShieldCheck className="h-4 w-4" />
              {initiative.scorecardName}
            </Link>
            <Badge variant="outline" className="font-normal">
              {targetLevelLabel(initiative.targetLevel)}
            </Badge>
            <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-red-600')}>
              <CalendarClock className="h-4 w-4" />
              {formatDeadline(initiative.deadline)}
              {overdue && ' · overdue'}
            </span>
            {initiative.ownerName && (
              <span className="inline-flex items-center gap-1">
                <User className="h-4 w-4" />
                {initiative.ownerName}
              </span>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {isActive && (
              <Button size="sm" variant="outline" onClick={handleSync} disabled={busy !== null}>
                {busy === 'sync' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Sync now
              </Button>
            )}
            {isActive ? (
              <>
                <Button
                  size="sm"
                  onClick={() => setConfirm('completed')}
                  disabled={busy !== null}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirm('cancelled')}
                  disabled={busy !== null}
                >
                  <XCircle className="h-4 w-4" />
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => handleStatus('active')} disabled={busy !== null}>
                {busy === 'status' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reactivate
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="max-w-md">
        <InitiativeProgressBar progress={initiative.progress} />
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'completed' ? 'Complete this initiative?' : 'Cancel this initiative?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'completed'
                ? 'Marking it completed stops automatic syncing. You can reactivate it later.'
                : 'Cancelling stops automatic syncing and archives the campaign. You can reactivate it later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Keep active</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (confirm) handleStatus(confirm)
              }}
              disabled={busy !== null}
            >
              {busy === 'status' && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirm === 'completed' ? 'Complete' : 'Cancel initiative'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
