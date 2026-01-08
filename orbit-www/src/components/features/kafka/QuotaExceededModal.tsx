'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { QuotaInfo } from '@/lib/kafka/quotas'

interface QuotaExceededModalProps {
  open: boolean
  onClose: () => void
  onSubmitRequest: () => void
  quotaInfo: QuotaInfo
  applicationName: string
  isSubmitting: boolean
}

export function QuotaExceededModal({
  open,
  onClose,
  onSubmitRequest,
  quotaInfo,
  applicationName,
  isSubmitting,
}: QuotaExceededModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/20">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <DialogTitle>Application Quota Reached</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Your workspace has reached its Kafka application quota.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current usage</span>
              <span className="font-medium">
                {quotaInfo.used} of {quotaInfo.quota} applications
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-yellow-500"
                style={{ width: `${Math.min(100, (quotaInfo.used / quotaInfo.quota) * 100)}%` }}
              />
            </div>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Would you like to submit a request to create{' '}
            <span className="font-medium text-foreground">{applicationName}</span>? The request will
            be reviewed by your workspace admin and then by a platform admin.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={onSubmitRequest} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
