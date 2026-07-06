'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { approveRun, rejectRun } from '@/app/(frontend)/self-service/actions'

/**
 * Approve / Reject controls for a run sitting at `awaiting-approval`. Rendered
 * regardless of role — the server actions enforce who may approve and error
 * otherwise (defense in depth). When the caller can compute a `canApprove`
 * flag, the buttons are dimmed/disabled for those who can't (optional UX).
 */
export function ApprovalButtons({
  runId,
  canApprove = true,
}: {
  runId: string
  canApprove?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)

  async function handle(kind: 'approve' | 'reject') {
    setPending(kind)
    try {
      if (kind === 'approve') {
        await approveRun(runId)
        toast.success('Run approved')
      } else {
        await rejectRun(runId)
        toast.success('Run rejected')
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${kind} run`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={!canApprove || pending !== null} onClick={() => handle('approve')}>
        {pending === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-muted-foreground hover:text-destructive"
        disabled={!canApprove || pending !== null}
        onClick={() => handle('reject')}
      >
        {pending === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        Reject
      </Button>
    </div>
  )
}
