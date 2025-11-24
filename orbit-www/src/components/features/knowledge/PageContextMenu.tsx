'use client'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Edit, FolderTree, FilePlus, Copy, Trash } from 'lucide-react'
import type { KnowledgePage } from '@/payload-types'

interface PageContextMenuProps {
  page: KnowledgePage
  children: React.ReactNode
  onRename?: (pageId: string) => void
  onMove?: (pageId: string) => void
  onAddSubPage?: (pageId: string) => void
  onDuplicate?: (pageId: string) => void
  onDelete?: (pageId: string) => void
}

export function PageContextMenu({
  page,
  children,
  onRename,
  onMove,
  onAddSubPage,
  onDuplicate,
  onDelete,
}: PageContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => onRename?.(page.id)}>
          <Edit className="h-4 w-4 mr-2" />
          Rename
        </ContextMenuItem>

        <ContextMenuItem onClick={() => onMove?.(page.id)}>
          <FolderTree className="h-4 w-4 mr-2" />
          Move to...
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => onAddSubPage?.(page.id)}>
          <FilePlus className="h-4 w-4 mr-2" />
          Add sub-page
        </ContextMenuItem>

        <ContextMenuItem onClick={() => onDuplicate?.(page.id)}>
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() => onDelete?.(page.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash className="h-4 w-4 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
