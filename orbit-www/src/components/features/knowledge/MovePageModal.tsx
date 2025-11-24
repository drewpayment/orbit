'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { KnowledgePage } from '@/payload-types'

interface MovePageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPage: KnowledgePage
  pages: KnowledgePage[]
  onMove: (pageId: string, newParentId: string | null) => Promise<void>
}

/**
 * Get all descendant IDs of a page recursively
 */
function getDescendantIds(pageId: string, pages: KnowledgePage[]): Set<string> {
  const descendants = new Set<string>()

  const findChildren = (parentId: string) => {
    pages.forEach(page => {
      const pageParentId = typeof page.parentPage === 'string'
        ? page.parentPage
        : page.parentPage?.id

      if (pageParentId === parentId) {
        descendants.add(page.id)
        findChildren(page.id) // Recursively find children's children
      }
    })
  }

  findChildren(pageId)
  return descendants
}

export function MovePageModal({
  open,
  onOpenChange,
  currentPage,
  pages,
  onMove,
}: MovePageModalProps) {
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  const [isMoving, setIsMoving] = useState(false)

  // Exclude current page and its descendants
  const descendantIds = getDescendantIds(currentPage.id, pages)
  const availablePages = pages.filter((p) => {
    if (p.id === currentPage.id) return false
    if (descendantIds.has(p.id)) return false
    return true
  })

  const handleMove = async () => {
    setIsMoving(true)
    try {
      await onMove(currentPage.id, selectedParentId)
      onOpenChange(false)
    } finally {
      setIsMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif-display">Move Page</DialogTitle>
          <DialogDescription>
            Select a new parent page for "{currentPage.title}"
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <ScrollArea className="h-64">
            <div
              className="p-2"
              role="listbox"
              aria-label="Available parent pages"
            >
              <button
                role="option"
                aria-selected={selectedParentId === null}
                onClick={() => setSelectedParentId(null)}
                className={`w-full text-left px-3 py-2 rounded hover:bg-accent transition-colors ${
                  selectedParentId === null ? 'bg-accent' : ''
                }`}
              >
                Root (No parent)
              </button>

              {availablePages.map((page) => (
                <button
                  key={page.id}
                  role="option"
                  aria-selected={selectedParentId === page.id}
                  onClick={() => setSelectedParentId(page.id)}
                  className={`w-full text-left px-3 py-2 rounded hover:bg-accent transition-colors ${
                    selectedParentId === page.id ? 'bg-accent' : ''
                  }`}
                >
                  {page.title}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={isMoving}>
            {isMoving ? 'Moving...' : 'Move Page'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
