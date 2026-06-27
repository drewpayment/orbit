'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { ScorecardForm, type ScorecardFormInitial } from './ScorecardForm'
import { deleteScorecard } from '@/app/(frontend)/scorecards/actions'

/**
 * Edit-meta + delete affordances for a scorecard detail page header. Rendered
 * only when the server computed `canManage` for the user; the actions are still
 * RBAC-enforced server-side regardless.
 */
export function ManageScorecardActions({
  scorecardId,
  scorecardName,
  initial,
}: {
  scorecardId: string
  scorecardName: string
  initial: ScorecardFormInitial
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteScorecard(scorecardId)
      toast.success('Scorecard deleted')
      router.push('/scorecards')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete scorecard')
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        <Pencil className="h-4 w-4" />
        Edit
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setConfirmingDelete(true)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit scorecard</DialogTitle>
            <DialogDescription>Update the metadata and maturity ladder.</DialogDescription>
          </DialogHeader>
          <ScorecardForm
            mode="edit"
            scorecardId={scorecardId}
            initial={initial}
            onDone={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this scorecard?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{scorecardName}&rdquo;, all of its rules and every evaluation result will be
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
