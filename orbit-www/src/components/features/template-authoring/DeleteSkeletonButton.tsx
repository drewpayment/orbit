/**
 * Small delete affordance for a skeleton list row (Template Authoring
 * Phase 3, Task 3). A confirm dialog guards the call — `deleteSkeleton`
 * itself re-checks RBAC server-side regardless of what this button shows.
 */
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
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
import type { SkeletonActionResult } from '@/app/(frontend)/self-service/templates/skeletons/skeleton-actions'

export interface DeleteSkeletonButtonProps {
  id: string
  name: string
  onDelete: (id: string) => Promise<SkeletonActionResult<{ id: string }>>
}

export function DeleteSkeletonButton({ id, name, onDelete }: DeleteSkeletonButtonProps) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleConfirm() {
    setPending(true)
    setError(null)
    const result = await onDelete(id)
    if (!result.ok) {
      setError(result.errors.join(' '))
      setPending(false)
      return
    }
    router.refresh()
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Delete ${name}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the skeleton permanently. Any template step that fetches it will fail until repointed.
            {error ? <span className="mt-2 block text-destructive">{error}</span> : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
