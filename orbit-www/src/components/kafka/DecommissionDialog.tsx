'use client'

import { useState, useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import {
  decommissionApplication,
  forceDeleteApplication,
} from '@/app/actions/kafka-application-lifecycle'

export interface DecommissionDialogProps {
  applicationId: string
  applicationName: string
  applicationSlug: string
  status: 'active' | 'decommissioning'
  gracePeriodEndsAt?: string
  onComplete?: () => void
}

type DecommissionMode = 'graceful' | 'force'

export function DecommissionDialog({
  applicationId,
  applicationName,
  applicationSlug,
  status,
  gracePeriodEndsAt,
  onComplete,
}: DecommissionDialogProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DecommissionMode>('graceful')
  const [confirmationSlug, setConfirmationSlug] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const isForceDeleteConfirmed = confirmationSlug === applicationSlug

  const handleSubmit = () => {
    setError(null)

    if (mode === 'force' && !isForceDeleteConfirmed) {
      setError('Please type the application slug to confirm deletion')
      return
    }

    startTransition(async () => {
      try {
        if (mode === 'graceful') {
          const result = await decommissionApplication({
            applicationId,
            reason: reason || undefined,
          })

          if (!result.success) {
            setError(result.error || 'Failed to decommission application')
            return
          }
        } else {
          const result = await forceDeleteApplication(
            applicationId,
            reason || undefined
          )

          if (!result.success) {
            setError(result.error || 'Failed to delete application')
            return
          }
        }

        // Success - close dialog and notify parent
        setOpen(false)
        resetForm()
        onComplete?.()
      } catch (err) {
        setError('An unexpected error occurred')
        console.error('Decommission error:', err)
      }
    })
  }

  const resetForm = () => {
    setMode('graceful')
    setConfirmationSlug('')
    setReason('')
    setError(null)
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      resetForm()
    }
  }

  // Determine button text based on status
  const triggerButtonText = status === 'decommissioning' ? 'Force Delete' : 'Decommission'
  const TriggerButtonIcon = status === 'decommissioning' ? Trash2 : AlertTriangle

  // If already decommissioning, force delete is the only option
  const effectiveMode = status === 'decommissioning' ? 'force' : mode

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <TriggerButtonIcon className="mr-2 h-4 w-4" />
          {triggerButtonText}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {status === 'decommissioning'
              ? 'Force Delete Application'
              : 'Decommission Application'}
          </DialogTitle>
          <DialogDescription>
            {status === 'decommissioning' ? (
              <>
                <strong>{applicationName}</strong> is currently being decommissioned.
                {gracePeriodEndsAt && (
                  <>
                    {' '}
                    The grace period ends on{' '}
                    <strong>
                      {new Date(gracePeriodEndsAt).toLocaleDateString()}
                    </strong>
                    .
                  </>
                )}
                {' '}You can force delete to remove it immediately.
              </>
            ) : (
              <>
                Choose how to decommission <strong>{applicationName}</strong>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Mode selection - only show when not already decommissioning */}
          {status !== 'decommissioning' && (
            <div className="space-y-3">
              <Label>Decommission Mode</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMode('graceful')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    mode === 'graceful'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                >
                  <div className="font-medium">Graceful</div>
                  <div className="text-xs text-muted-foreground">
                    30-day grace period for production
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('force')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    mode === 'force'
                      ? 'border-destructive bg-destructive/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                >
                  <div className="font-medium text-destructive">Force Delete</div>
                  <div className="text-xs text-muted-foreground">
                    Immediate deletion, no grace period
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Force delete warning and confirmation */}
          {effectiveMode === 'force' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warning:</strong> This action cannot be undone. All topics,
                virtual clusters, and associated data will be permanently deleted.
              </AlertDescription>
            </Alert>
          )}

          {effectiveMode === 'force' && (
            <div className="space-y-2">
              <Label htmlFor="confirm-slug">
                Type <code className="rounded bg-muted px-1 py-0.5 text-sm">{applicationSlug}</code> to confirm
              </Label>
              <Input
                id="confirm-slug"
                value={confirmationSlug}
                onChange={(e) => setConfirmationSlug(e.target.value)}
                placeholder={applicationSlug}
                autoComplete="off"
              />
            </div>
          )}

          {/* Graceful mode info */}
          {effectiveMode === 'graceful' && (
            <Alert>
              <AlertDescription>
                Graceful decommissioning sets all virtual clusters to read-only mode
                and starts a grace period. During this time, you can cancel the
                decommissioning to restore access.
              </AlertDescription>
            </Alert>
          )}

          {/* Reason textarea */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this application being decommissioned?"
              rows={3}
            />
          </div>

          {/* Error display */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || (effectiveMode === 'force' && !isForceDeleteConfirmed)}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {effectiveMode === 'force' ? 'Delete Application' : 'Decommission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
