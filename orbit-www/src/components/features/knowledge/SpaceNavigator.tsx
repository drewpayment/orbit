'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Plus, Search, FileText, Loader2 } from 'lucide-react'
import { PageTreeNode } from './PageTreeNode'
import { buildPageTree } from '@/lib/knowledge/tree-builder'
import type { SpaceNavigatorProps } from './types'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

export function SpaceNavigator({
  knowledgeSpace,
  pages,
  currentPageId,
  onPageSelect,
  workspaceSlug,
  onReorder,
  isLoading = false,
}: SpaceNavigatorProps) {
  const tree = useMemo(() => buildPageTree(pages), [pages])
  const [activeId, setActiveId] = useState<string | null>(null)

  const publishedPages = pages.filter(p => p.status === 'published').length
  const draftPages = pages.filter(p => p.status === 'draft').length

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over || active.id === over.id) {
      return
    }

    if (onReorder) {
      // Find the indices of the dragged item and the item it's being dropped on
      const oldIndex = pages.findIndex(p => p.id === active.id)
      const newIndex = pages.findIndex(p => p.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        // Create new page order
        const reorderedPages = [...pages]
        const [movedPage] = reorderedPages.splice(oldIndex, 1)
        reorderedPages.splice(newIndex, 0, movedPage)

        // Generate new sort orders
        const pageOrders = reorderedPages.map((page, index) => ({
          pageId: page.id,
          sortOrder: index,
          parentId: page.parentId,
        }))

        onReorder(pageOrders)
      }
    }
  }

  if (isLoading) {
    return (
      <Card className="w-full h-full flex flex-col">
        <CardContent className="flex-1 flex items-center justify-center">
          <div data-testid="space-navigator-loading" className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading pages...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{knowledgeSpace.name}</CardTitle>
          <Button size="sm" variant="ghost">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {knowledgeSpace.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {knowledgeSpace.description}
          </p>
        )}
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 overflow-auto py-4">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FileText className="h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-4">
              No pages yet. Create your first page to get started.
            </p>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Page
            </Button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={pages.map(p => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {tree.map(node => (
                  <PageTreeNode
                    key={node.id}
                    node={node}
                    currentPageId={currentPageId}
                    depth={0}
                    onPageSelect={onPageSelect}
                    workspaceSlug={workspaceSlug}
                    spaceSlug={knowledgeSpace.slug}
                    isDragging={activeId === node.id}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId ? (
                <div className="bg-accent/90 p-2 rounded-md shadow-lg">
                  {pages.find(p => p.id === activeId)?.title || 'Dragging...'}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </CardContent>

      <Separator />

      <div className="p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{publishedPages} published</span>
          <span>{draftPages} drafts</span>
        </div>
      </div>
    </Card>
  )
}
