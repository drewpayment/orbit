'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { PageContextMenu } from './PageContextMenu'
import type { PageTreeNodeProps } from './types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { renamePage } from '@/app/actions/knowledge'

export function PageTreeNode({
  node,
  currentPageId,
  depth,
  onPageSelect,
  workspaceSlug,
  spaceSlug,
  onMoveClick,
  onDeleteClick,
  onDuplicateClick,
  onAddSubPageClick,
}: PageTreeNodeProps) {
  const hasChildren = node.children.length > 0
  const isCurrentPage = node.id === currentPageId
  const [isOpen, setIsOpen] = useState(false)

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false)
  const [newTitle, setNewTitle] = useState(node.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: node.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  }

  // Auto-expand if this node is in the path to current page
  useEffect(() => {
    if (isCurrentPage || node.children.some(child => child.id === currentPageId)) {
      setIsOpen(true)
    }
  }, [currentPageId, isCurrentPage, node.children])

  // Focus input when renaming starts
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const handleClick = (e: React.MouseEvent) => {
    if (onPageSelect) {
      e.preventDefault()
      onPageSelect(node.id)
    }
  }

  // Context menu handlers
  const handleRename = (pageId: string) => {
    setIsRenaming(true)
    setNewTitle(node.title)
  }

  const saveRename = async () => {
    if (newTitle.trim() && newTitle !== node.title) {
      await renamePage(node.id, newTitle, workspaceSlug, spaceSlug as string)
    }
    setIsRenaming(false)
  }

  const handleMove = (pageId: string) => {
    onMoveClick?.(pageId)
  }

  const handleAddSubPage = (pageId: string) => {
    onAddSubPageClick?.(pageId)
  }

  const handleDuplicate = async (pageId: string) => {
    await onDuplicateClick?.(pageId)
  }

  const handleDelete = (pageId: string) => {
    onDeleteClick?.(pageId)
  }

  // Build the page URL
  const pageUrl = workspaceSlug && spaceSlug
    ? `/workspaces/${workspaceSlug}/knowledge/${spaceSlug}/${node.slug}`
    : `#page-${node.id}`

  const content = (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors group',
        isCurrentPage && 'bg-accent font-medium'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isCurrentPage}
      aria-current={isCurrentPage ? 'page' : undefined}
    >
      <div
        {...listeners}
        {...attributes}
        data-testid={`page-drag-${node.id}`}
        aria-grabbed={isSortableDragging}
        aria-label={`Drag handle for ${node.title}`}
        className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', node.id)
        }}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {hasChildren ? (
        <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onBlur={saveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveRename()
            if (e.key === 'Escape') {
              setIsRenaming(false)
              setNewTitle(node.title)
            }
          }}
          className="px-2 py-1 text-sm bg-background border border-border rounded flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate flex-1">{node.title}</span>
      )}
    </div>
  )

  if (!hasChildren) {
    return (
      <div ref={setNodeRef} style={style}>
        <PageContextMenu
          page={node as any}
          onRename={handleRename}
          onMove={handleMove}
          onAddSubPage={handleAddSubPage}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        >
          <Link
            href={pageUrl}
            onClick={handleClick}
            className="block"
          >
            {content}
          </Link>
        </PageContextMenu>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="space-y-1">
          <div className="flex items-center">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                style={{ marginLeft: `${depth * 12}px` }}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.title}`}
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 transition-transform',
                    isOpen && 'rotate-90'
                  )}
                  aria-hidden="true"
                />
              </Button>
            </CollapsibleTrigger>
            <PageContextMenu
              page={node as any}
              onRename={handleRename}
              onMove={handleMove}
              onAddSubPage={handleAddSubPage}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            >
              <Link
                href={pageUrl}
                onClick={handleClick}
                className="flex-1"
              >
                {content}
              </Link>
            </PageContextMenu>
          </div>
          <CollapsibleContent>
            <div className="space-y-1">
              {node.children.map(child => (
                <PageTreeNode
                  key={child.id}
                  node={child}
                  currentPageId={currentPageId}
                  depth={depth + 1}
                  onPageSelect={onPageSelect}
                  workspaceSlug={workspaceSlug}
                  spaceSlug={spaceSlug}
                  onMoveClick={onMoveClick}
                  onDeleteClick={onDeleteClick}
                  onDuplicateClick={onDuplicateClick}
                  onAddSubPageClick={onAddSubPageClick}
                />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  )
}
