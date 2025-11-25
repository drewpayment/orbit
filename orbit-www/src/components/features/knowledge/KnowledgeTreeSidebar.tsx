'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus, FileText } from 'lucide-react'
import { PageTreeNode } from './PageTreeNode'
import { buildPageTree } from '@/lib/knowledge/tree-builder'
import { CreatePageModal } from './CreatePageModal'
import { MovePageModal } from './MovePageModal'
import { DeletePageDialog } from './DeletePageDialog'
import { createKnowledgePage, movePage, duplicatePage, deletePage, updatePageSortOrder } from '@/app/actions/knowledge'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { KnowledgePage, KnowledgeSpace } from '@/payload-types'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

export interface KnowledgeTreeSidebarProps {
  space: KnowledgeSpace
  pages: KnowledgePage[]
  currentPageId?: string
  workspaceSlug: string
  userId?: string
}

// Root level drop zone component - invisible until dragging over it
function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: 'root-drop-zone',
  })

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[50px] flex-1 transition-colors ${
        isOver
          ? 'bg-primary/10 border-2 border-dashed border-primary rounded-md mx-2 mb-2'
          : ''
      }`}
    >
      {isOver && (
        <div className="flex items-center justify-center h-full text-xs text-primary font-medium">
          Drop to move to root level
        </div>
      )}
    </div>
  )
}

export function KnowledgeTreeSidebar({
  space,
  pages,
  currentPageId,
  workspaceSlug,
  userId,
}: KnowledgeTreeSidebarProps) {
  const tree = useMemo(() => buildPageTree(pages), [pages])
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createModalParentId, setCreateModalParentId] = useState<string | undefined>(undefined)
  const [movePageId, setMovePageId] = useState<string | null>(null)
  const [deletePageId, setDeletePageId] = useState<string | null>(null)
  const router = useRouter()

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleCreatePage = async (data: {
    title: string
    slug: string
    parentPageId?: string
  }) => {
    if (!userId) {
      alert('You must be logged in to create pages.')
      return
    }

    const newPage = await createKnowledgePage({
      title: data.title,
      slug: data.slug,
      knowledgeSpaceId: space.id,
      parentPageId: data.parentPageId,
      userId,
      workspaceSlug,
      spaceSlug: space.slug as string,
    })

    // Navigate to the new page
    router.push(`/workspaces/${workspaceSlug}/knowledge/${space.slug}/${newPage.slug}`)
  }

  const handleMove = async (pageId: string, newParentId: string | null) => {
    try {
      await movePage(pageId, newParentId, workspaceSlug, space.slug as string)
      router.refresh()
      toast.success('Page moved successfully')
    } catch (error) {
      console.error('Failed to move page:', error)
      toast.error('Failed to move page. Please try again.')
    }
  }

  const handleDuplicate = async (pageId: string) => {
    try {
      const duplicate = await duplicatePage(pageId, workspaceSlug, space.slug as string)
      router.push(`/workspaces/${workspaceSlug}/knowledge/${space.slug}/${duplicate.slug}`)
      toast.success('Page duplicated successfully')
    } catch (error) {
      console.error('Failed to duplicate page:', error)
      toast.error('Failed to duplicate page. Please try again.')
    }
  }

  const handleDelete = async (pageId: string) => {
    try {
      await deletePage(pageId, workspaceSlug, space.slug as string)
      router.push(`/workspaces/${workspaceSlug}/knowledge/${space.slug}`)
      toast.success('Page deleted successfully')
    } catch (error) {
      console.error('Failed to delete page:', error)
      toast.error('Failed to delete page. Please try again.')
    }
  }

  const handleAddSubPage = (pageId: string) => {
    setCreateModalParentId(pageId)
    setIsCreateModalOpen(true)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    // Special case: dropping on the root level zone
    if (over.id === 'root-drop-zone') {
      try {
        await movePage(active.id as string, null, workspaceSlug, space.slug as string)
        router.refresh()
        toast.success('Page moved to root level')
      } catch (error) {
        console.error('Failed to move page:', error)
        toast.error('Failed to move page. Please try again.')
      }
      return
    }

    const activePage = pages.find(p => p.id === active.id)
    const overPage = pages.find(p => p.id === over.id)

    if (!activePage || !overPage) {
      return
    }

    // Prevent moving a page under itself or its descendants
    const isDescendant = (checkNodeId: string, potentialAncestorId: string): boolean => {
      const node = pages.find(p => p.id === checkNodeId)
      if (!node) return false

      const nodeParentId = typeof node.parentPage === 'object' && node.parentPage
        ? node.parentPage.id
        : node.parentPage

      if (!nodeParentId) return false
      if (nodeParentId === potentialAncestorId) return true
      return isDescendant(nodeParentId, potentialAncestorId)
    }

    // Check if we're trying to move a page under its own descendant (circular reference)
    if (isDescendant(over.id as string, active.id as string)) {
      toast.error('Cannot move a page under itself or its descendants')
      return
    }

    // Extract parent IDs for both pages
    const getParentId = (page: KnowledgePage): string | null => {
      if (!page.parentPage) return null
      if (typeof page.parentPage === 'string') return page.parentPage
      if (typeof page.parentPage === 'object' && page.parentPage.id) return page.parentPage.id
      return null
    }

    const activeParentId = getParentId(activePage)
    const overParentId = getParentId(overPage)

    // If pages have the same parent, reorder them as siblings
    // Otherwise, nest the active page under the over page
    try {
      if (activeParentId === overParentId) {
        // Reorder siblings - swap their sort orders
        await updatePageSortOrder(active.id as string, over.id as string, workspaceSlug, space.slug as string)
        router.refresh()
        toast.success('Pages reordered')
      } else {
        // Different parents - nest active page under over page
        await movePage(active.id as string, over.id as string, workspaceSlug, space.slug as string)
        router.refresh()
        toast.success('Page moved successfully')
      }
    } catch (error) {
      console.error('Failed to move page:', error)
      toast.error('Failed to move page. Please try again.')
    }
  }

  return (
    <aside className="w-64 border-r border-border bg-background flex flex-col">
      {/* Header with space info */}
      <div className="p-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-2">
          {space.icon && <span className="text-2xl">{space.icon}</span>}
          <h2 className="font-serif-display font-semibold text-lg">
            {space.name}
          </h2>
        </div>
        {space.description && (
          <p className="text-xs text-muted-foreground">
            {space.description}
          </p>
        )}
      </div>

      {/* Tree navigation */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <nav
          className="flex-1 overflow-y-auto flex flex-col p-2"
          role="tree"
          aria-label={`${space.name} knowledge pages`}
        >
          {tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <FileText className="h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-4">
                No pages yet. Create your first page to get started.
              </p>
              <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Page
              </Button>
            </div>
          ) : (
            <>
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
                      workspaceSlug={workspaceSlug}
                      spaceSlug={space.slug}
                      onMoveClick={setMovePageId}
                      onDeleteClick={setDeletePageId}
                      onDuplicateClick={handleDuplicate}
                      onAddSubPageClick={handleAddSubPage}
                    />
                  ))}
                </div>
              </SortableContext>
              {/* Empty space below pages acts as drop zone for moving to root level */}
              <RootDropZone />
            </>
          )}
        </nav>
      </DndContext>

      {/* Bottom actions */}
      <div className="p-2 border-t border-border/40">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => setIsCreateModalOpen(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Page
        </Button>
      </div>

      <CreatePageModal
        open={isCreateModalOpen}
        onOpenChange={(open) => {
          setIsCreateModalOpen(open)
          if (!open) setCreateModalParentId(undefined)
        }}
        knowledgeSpaceId={space.id}
        pages={pages}
        preselectedParentId={createModalParentId}
        onCreatePage={handleCreatePage}
      />

      {movePageId && pages.find(p => p.id === movePageId) && (
        <MovePageModal
          open={!!movePageId}
          onOpenChange={() => setMovePageId(null)}
          currentPage={pages.find(p => p.id === movePageId)!}
          pages={pages}
          onMove={handleMove}
        />
      )}

      {deletePageId && pages.find(p => p.id === deletePageId) && (
        <DeletePageDialog
          open={!!deletePageId}
          onOpenChange={() => setDeletePageId(null)}
          page={pages.find(p => p.id === deletePageId)!}
          onDelete={handleDelete}
        />
      )}
    </aside>
  )
}
