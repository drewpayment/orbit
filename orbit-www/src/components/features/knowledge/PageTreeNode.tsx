'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { PageContextMenu } from './PageContextMenu'
import type { PageTreeNodeProps } from './types'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export function PageTreeNode({
  node,
  currentPageId,
  depth,
  onPageSelect,
  workspaceSlug,
  spaceSlug,
  isDragging = false,
}: PageTreeNodeProps) {
  const hasChildren = node.children.length > 0
  const isCurrentPage = node.id === currentPageId
  const [isOpen, setIsOpen] = useState(false)

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

  const handleClick = (e: React.MouseEvent) => {
    if (onPageSelect) {
      e.preventDefault()
      onPageSelect(node.id)
    }
  }

  // Context menu handlers (placeholder implementations)
  const handleRename = (pageId: string) => {
    console.log('Rename:', pageId)
  }

  const handleMove = (pageId: string) => {
    console.log('Move:', pageId)
  }

  const handleAddSubPage = (pageId: string) => {
    console.log('Add sub-page:', pageId)
  }

  const handleDuplicate = async (pageId: string) => {
    console.log('Duplicate:', pageId)
  }

  const handleDelete = (pageId: string) => {
    console.log('Delete:', pageId)
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
        aria-grabbed={isDragging}
        aria-label={`Drag handle for ${node.title}`}
        className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {hasChildren ? (
        <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate flex-1">{node.title}</span>
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
                  isDragging={isDragging}
                />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  )
}
