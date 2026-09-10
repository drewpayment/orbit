/**
 * Mid-run approval gate — Template Authoring Phase 4, Task C.
 *
 * Rendered on the run-detail page when a step is `awaiting-approval` (an
 * `approval:request` step parked the whole workflow on a human signal).
 * Distinct from `ApprovalButtons` (the pre-dispatch action-level
 * `approvalPolicy` gate, `run.status === 'awaiting-approval'` with NO
 * awaiting-approval step): this one resolves ONE step's gate via
 * `resolveScaffolderApproval`, not the whole run's dispatch.
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveScaffolderApproval } from '@/app/(frontend)/self-service/templates/run-actions'

export interface ScaffolderApprovalGateProps {
  runId: string
  approvalId: string
  message: string
  /**
   * Server-computed `canApproveScaffolderStep` result, threaded through by
   * the page — a UI affordance only. `resolveScaffolderApproval` re-checks
   * the real gate server-side regardless (defense in depth, not the
   * authority), so a viewer with `canApprove: false` sees a read-only badge
   * instead of disabled buttons: they cannot act on this gate at all, not
   * only "not yet".
   */
  canApprove: boolean
}

export function ScaffolderApprovalGate({ runId, approvalId, message, canApprove }: ScaffolderApprovalGateProps) {
  const router = useRouter()
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)

  async function handle(approved: boolean) {
    setPending(approved ? 'approve' : 'reject')
    try {
      const result = await resolveScaffolderApproval(runId, approvalId, approved, comment.trim() || undefined)
      if (!result.ok) {
        toast.error(result.errors?.[0] ?? `Failed to ${approved ? 'approve' : 'reject'} step`)
        return
      }
      toast.success(approved ? 'Step approved' : 'Step rejected')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${approved ? 'approve' : 'reject'} step`)
    } finally {
      setPending(null)
    }
  }

  if (!canApprove) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-amber-600 dark:text-amber-400">Awaiting approval</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Waiting on a workspace owner/admin or a listed approver to resolve this step.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-amber-600 dark:text-amber-400">Approval requested</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{message}</p>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment"
          disabled={pending !== null}
          rows={2}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending !== null} onClick={() => handle(true)}>
            {pending === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-muted-foreground hover:text-destructive"
            disabled={pending !== null}
            onClick={() => handle(false)}
          >
            {pending === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
