'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Check, ChevronDown, Loader2, X, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import {
  approveRequestAsWorkspaceAdmin,
  rejectRequestAsWorkspaceAdmin,
  approveRequestAsPlatformAdmin,
  rejectRequestAsPlatformAdmin,
} from '@/app/actions/kafka-application-requests'

interface ApprovalActionsDropdownProps {
  requestId: string
  tier: 'workspace' | 'platform'
  onActionComplete: () => void
}

export function ApprovalActionsDropdown({
  requestId,
  tier,
  onActionComplete,
}: ApprovalActionsDropdownProps) {
  const [loading, setLoading] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const handleApprove = async (action?: 'single' | 'increase_quota') => {
    setLoading(true)
    try {
      const result =
        tier === 'workspace'
          ? await approveRequestAsWorkspaceAdmin(requestId)
          : await approveRequestAsPlatformAdmin(requestId, action || 'single')

      if (result.success) {
        toast.success(
          tier === 'workspace'
            ? 'Request approved and forwarded to platform admin'
            : action === 'increase_quota'
              ? 'Request approved and workspace quota increased'
              : 'Request approved'
        )
        onActionComplete()
      } else {
        toast.error(result.error || 'Failed to approve request')
      }
    } catch {
      toast.error('Failed to approve request')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setLoading(true)
    try {
      const result =
        tier === 'workspace'
          ? await rejectRequestAsWorkspaceAdmin(requestId, rejectionReason || undefined)
          : await rejectRequestAsPlatformAdmin(requestId, rejectionReason || undefined)

      if (result.success) {
        toast.success('Request rejected')
        setShowRejectDialog(false)
        setRejectionReason('')
        onActionComplete()
      } else {
        toast.error(result.error || 'Failed to reject request')
      }
    } catch {
      toast.error('Failed to reject request')
    } finally {
      setLoading(false)
    }
  }

  if (tier === 'workspace') {
    return (
      <>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => handleApprove()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRejectDialog(true)}
            disabled={loading}
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
        </div>

        <RejectDialog
          open={showRejectDialog}
          onOpenChange={setShowRejectDialog}
          reason={rejectionReason}
          onReasonChange={setRejectionReason}
          onConfirm={handleReject}
          loading={loading}
        />
      </>
    )
  }

  // Platform tier - has dropdown for approve options
  return (
    <>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Approve
                  <ChevronDown className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleApprove('single')}>
              <Check className="h-4 w-4 mr-2" />
              Approve this request
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleApprove('increase_quota')}>
              <TrendingUp className="h-4 w-4 mr-2" />
              Approve & increase workspace quota
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowRejectDialog(true)}
          disabled={loading}
        >
          <X className="h-4 w-4 mr-1" />
          Reject
        </Button>
      </div>

      <RejectDialog
        open={showRejectDialog}
        onOpenChange={setShowRejectDialog}
        reason={rejectionReason}
        onReasonChange={setRejectionReason}
        onConfirm={handleReject}
        loading={loading}
      />
    </>
  )
}

// Shared reject dialog
function RejectDialog({
  open,
  onOpenChange,
  reason,
  onReasonChange,
  onConfirm,
  loading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reason: string
  onReasonChange: (reason: string) => void
  onConfirm: () => void
  loading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Reject Request</DialogTitle>
          <DialogDescription>
            Are you sure you want to reject this application request?
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Textarea
            id="reason"
            placeholder="Explain why this request is being rejected..."
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            className="mt-2"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
