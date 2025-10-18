'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import type { PageTreeNodeProps } from './types'

export function PageTreeNode({
  node,
  currentPageId,
  depth,
  onPageSelect,
  workspaceSlug,
  spaceSlug,
}: PageTreeNodeProps) {
  const hasChildren = node.children.length > 0
  const isCurrentPage = node.id === currentPageId
  const [isOpen, setIsOpen] = useState(false)
  
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
  
  // Build the page URL
  const pageUrl = workspaceSlug && spaceSlug
    ? `/workspaces/${workspaceSlug}/knowledge/${spaceSlug}/${node.slug}`
    : `#page-${node.id}`
  
  const content = (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors',
        isCurrentPage && 'bg-accent font-medium',
        node.status === 'draft' && 'text-muted-foreground italic'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {hasChildren ? (
        <Folder className="h-4 w-4 shrink-0" />
      ) : (
        <FileText className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate flex-1">{node.title}</span>
      {node.status === 'draft' && (
        <span className="text-xs text-muted-foreground">(draft)</span>
      )}
    </div>
  )
  
  if (!hasChildren) {
    return (
      <Link
        href={pageUrl}
        onClick={handleClick}
        className="block"
      >
        {content}
      </Link>
    )
  }
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="space-y-1">
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              style={{ marginLeft: `${depth * 12}px` }}
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 transition-transform',
                  isOpen && 'rotate-90'
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <Link
            href={pageUrl}
            onClick={handleClick}
            className="flex-1"
          >
            {content}
          </Link>
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
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
