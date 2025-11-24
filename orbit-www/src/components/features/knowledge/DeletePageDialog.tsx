'use client'

import { useState } from 'react'
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
import type { KnowledgePage } from '@/payload-types'

interface DeletePageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  page: KnowledgePage
  onDelete: (pageId: string) => Promise<void>
}

/**
 * Get count of child pages recursively
 */
function getChildCount(page: KnowledgePage): number {
  if (!page.childPages || page.childPages.length === 0) {
    return 0
  }

  let count = page.childPages.length

  page.childPages.forEach(child => {
    if (typeof child !== 'string' && child.childPages) {
      count += getChildCount(child)
    }
  })

  return count
}

export function DeletePageDialog({
  open,
  onOpenChange,
  page,
  onDelete,
}: DeletePageDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const childCount = getChildCount(page)
  const hasChildren = childCount > 0

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await onDelete(page.id)
      onOpenChange(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif-display">
            Delete Page
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              Are you sure you want to delete "{page.title}"?
            </span>
            <span className="block text-sm">
              This action cannot be undone. The page will be permanently deleted.
            </span>
            {hasChildren && (
              <span className="block mt-3 text-destructive font-semibold">
                Warning: This page has {childCount} child page{childCount !== 1 ? 's' : ''} that will also be deleted.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
