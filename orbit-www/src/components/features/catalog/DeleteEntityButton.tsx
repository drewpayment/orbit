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
import { deleteCatalogEntity } from '@/app/(frontend)/catalog/entity-actions'

interface DeleteEntityButtonProps {
  entityId: string
  entityName: string
}

/**
 * Destructive delete for a manual catalog entity (Catalog Entity CRUD, WP2).
 * Guards the irreversible delete (entity + its relations) behind a confirm
 * dialog; deleteCatalogEntity re-checks delete rights and manual provenance
 * server-side before removing anything.
 */
export function DeleteEntityButton({ entityId, entityName }: DeleteEntityButtonProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteCatalogEntity(entityId)
      toast.success('Entity deleted')
      router.push('/catalog')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entity')
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="shrink-0 text-destructive">
          <Trash2 className="h-4 w-4" />
          Delete entity
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entity?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{entityName}&rdquo; and every relation to or from it will be permanently removed.
            This cannot be undone.
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
