'use client'

import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, AlertTriangle } from 'lucide-react'
import { deorbitLaunchAction } from '@/app/actions/launches'
import { toast } from 'sonner'

interface DeorbitConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  launchName: string
  workflowId: string
  onDeorbitStarted: () => void
}

export function DeorbitConfirmation({
  open,
  onOpenChange,
  launchName,
  workflowId,
  onDeorbitStarted,
}: DeorbitConfirmationProps) {
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isConfirmed = confirmText === launchName

  async function handleDeorbit() {
    if (!isConfirmed) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await deorbitLaunchAction(workflowId, reason || undefined)

      if (result.success) {
        toast.success(`Deorbit initiated for "${launchName}"`)
        onOpenChange(false)
        onDeorbitStarted()
      } else {
        setError(result.error || 'Failed to initiate deorbit')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setConfirmText('')
      setReason('')
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Deorbit Launch
          </DialogTitle>
          <DialogDescription>
            This will destroy all cloud resources provisioned by this launch. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              All infrastructure resources associated with <strong>{launchName}</strong> will be permanently destroyed.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type <span className="font-mono font-bold">{launchName}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={launchName}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you deorbiting this launch?"
              rows={3}
              disabled={isLoading}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeorbit}
            disabled={!isConfirmed || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deorbiting...
              </>
            ) : (
              'Deorbit'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
