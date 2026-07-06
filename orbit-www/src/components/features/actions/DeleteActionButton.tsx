'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { deleteAction } from '@/app/(frontend)/self-service/authoring-actions'

interface DeleteActionButtonProps {
  actionId: string
  actionName: string
}

/**
 * Destructive delete control for the Action edit page (IDP refocus P3). Guards
 * the irreversible delete behind a confirm dialog; the server action re-checks
 * authoring permission before removing the row.
 */
export function DeleteActionButton({ actionId, actionName }: DeleteActionButtonProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteAction(actionId)
      toast.success('Action deleted')
      router.push('/self-service')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete action')
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive">
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this action?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{actionName}&rdquo; will be permanently removed. Existing run history is
            unaffected, but the action can no longer be run. This cannot be undone.
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
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
