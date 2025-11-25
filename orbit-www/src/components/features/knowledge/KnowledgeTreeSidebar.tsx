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

    const activePage = pages.find(p => p.id === active.id)
    const overPage = pages.find(p => p.id === over.id)

    if (!activePage || !overPage) {
      return
    }

    // Prevent moving a page under itself or its descendants
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = pages.find(p => p.id === parentId)
      if (!parent) return false

      const parentPageId = typeof parent.parentPage === 'object' && parent.parentPage
        ? parent.parentPage.id
        : parent.parentPage

      if (!parentPageId) return false
      if (parentPageId === childId) return true
      return isDescendant(parentPageId, childId)
    }

    if (isDescendant(active.id as string, over.id as string)) {
      toast.error('Cannot move a page under itself or its descendants')
      return
    }

    // Dragging onto another page makes it a child of that page
    try {
      await movePage(active.id as string, over.id as string, workspaceSlug, space.slug as string)
      router.refresh()
      toast.success('Page moved successfully')
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
          className="flex-1 overflow-y-auto p-2"
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
          )}
        </nav>
      </DndContext>

      {/* Bottom actions with drop zone for root level */}
      <div className="p-2 border-t border-border/40">
        <div
          className="mb-2 p-2 border-2 border-dashed border-border/40 rounded-md text-center text-xs text-muted-foreground hover:border-border hover:bg-accent/50 transition-colors"
          onDragOver={(e) => {
            e.preventDefault()
            e.currentTarget.classList.add('border-primary', 'bg-primary/10')
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('border-primary', 'bg-primary/10')
          }}
          onDrop={async (e) => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-primary', 'bg-primary/10')

            const pageId = e.dataTransfer?.getData('text/plain')
            if (pageId) {
              try {
                await movePage(pageId, null, workspaceSlug, space.slug as string)
                router.refresh()
                toast.success('Page moved to root level')
              } catch (error) {
                console.error('Failed to move page:', error)
                toast.error('Failed to move page')
              }
            }
          }}
        >
          Drop here to move to root level
        </div>
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
