'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface DragHandleProps {
  editor: Editor
}

export function DragHandle({ editor }: DragHandleProps) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const draggedNodeRef = useRef<{ pos: number; node: any; size: number } | null>(null)
  const dragHandleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editorElement = editor.view.dom as HTMLElement
    const editorWrapper = editorElement.closest('.novel-editor') as HTMLElement

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Don't update position if hovering over the drag handle itself
      if (dragHandleRef.current?.contains(target)) {
        return
      }

      // Find block element
      const blockElement = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th')

      if (blockElement && blockElement instanceof HTMLElement) {
        const wrapperRect = editorWrapper.getBoundingClientRect()
        const blockRect = blockElement.getBoundingClientRect()

        setElement(blockElement)
        setPosition({
          top: blockRect.top - wrapperRect.top,
          left: blockRect.left - wrapperRect.left - 28,
        })
      }
      // If no block found but we're still in the editor, keep the handle visible at its current position
      // This allows moving from text to the handle without it disappearing
    }

    const handleMouseLeave = () => {
      // Only hide when leaving the entire editor
      setElement(null)
    }

    const handleDragOver = (event: DragEvent) => {
      // Allow dropping by preventing default
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
    }

    const handleDrop = (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (!draggedNodeRef.current) return

      const { pos: fromPos, node, size } = draggedNodeRef.current

      // Find the drop position
      const coordinates = { left: event.clientX, top: event.clientY }
      const dropPos = editor.view.posAtCoords(coordinates)

      if (!dropPos) return

      // Create a transaction to move the node
      const { tr } = editor.state

      // Calculate the actual positions considering the deletion
      let insertPos = dropPos.pos

      // If dropping after the dragged node, adjust for the deletion
      if (insertPos > fromPos) {
        insertPos -= size
      }

      // Delete from original position and insert at new position
      tr.delete(fromPos, fromPos + size)
      tr.insert(insertPos, node)

      // Apply the transaction
      editor.view.dispatch(tr)

      // Clear the dragged node
      draggedNodeRef.current = null
    }

    editorWrapper.addEventListener('mousemove', handleMouseMove)
    editorWrapper.addEventListener('mouseleave', handleMouseLeave)
    editorElement.addEventListener('dragover', handleDragOver)
    editorElement.addEventListener('drop', handleDrop)

    return () => {
      editorWrapper.removeEventListener('mousemove', handleMouseMove)
      editorWrapper.removeEventListener('mouseleave', handleMouseLeave)
      editorElement.removeEventListener('dragover', handleDragOver)
      editorElement.removeEventListener('drop', handleDrop)
    }
  }, [editor])

  const handleDragStart = (e: React.DragEvent) => {
    if (!element) return

    const { dataTransfer } = e

    // Find the ProseMirror position of this element
    try {
      const pos = editor.view.posAtDOM(element, 0)
      const $pos = editor.state.doc.resolve(pos)

      // Find the parent block node (paragraph, heading, etc.)
      const depth = $pos.depth
      const parentPos = depth > 0 ? $pos.before(depth) : pos
      const node = editor.state.doc.nodeAt(parentPos)

      if (node) {
        // Store the node info for later deletion
        draggedNodeRef.current = {
          pos: parentPos,
          node,
          // Store the size to know how much to delete
          size: node.nodeSize
        }
      }
    } catch (error) {
      console.error('Failed to find ProseMirror position:', error)
    }

    // Set the drag data
    dataTransfer.effectAllowed = 'move'
    dataTransfer.setData('text/html', element.outerHTML)
    // Mark this as our custom drag handle so we can prevent ProseMirror from handling it
    dataTransfer.setData('application/x-drag-handle', 'true')

    // Create a drag image from the element
    const dragImage = element.cloneNode(true) as HTMLElement
    dragImage.style.position = 'absolute'
    dragImage.style.top = '-9999px'
    document.body.appendChild(dragImage)
    dataTransfer.setDragImage(dragImage, 0, 0)
    setTimeout(() => document.body.removeChild(dragImage), 0)

    // Add visual feedback to the original element
    element.style.opacity = '0.5'
    element.classList.add('dragging')
  }

  const handleDragEnd = () => {
    if (!element) return

    element.style.opacity = ''
    element.classList.remove('dragging')

    // Clear the dragged node after a short delay to allow drop to complete
    setTimeout(() => {
      draggedNodeRef.current = null
    }, 100)
  }

  return (
    <div
      ref={dragHandleRef}
      className="drag-handle-wrapper absolute z-50 transition-opacity duration-100"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        opacity: element ? 1 : 0,
        pointerEvents: element ? 'auto' : 'none',
      }}
      contentEditable={false}
      draggable={!!element}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <button
        type="button"
        className="
          drag-handle-button
          flex items-center justify-center
          w-6 h-6
          rounded
          hover:bg-gray-200 dark:hover:bg-gray-700
          text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
          cursor-grab active:cursor-grabbing
          transition-colors
        "
        title="Drag to move"
        draggable={false}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 10 10"
          width="12"
          height="12"
          fill="currentColor"
        >
          <path d="M3,2 C2.44771525,2 2,1.55228475 2,1 C2,0.44771525 2.44771525,0 3,0 C3.55228475,0 4,0.44771525 4,1 C4,1.55228475 3.55228475,2 3,2 Z M3,6 C2.44771525,6 2,5.55228475 2,5 C2,4.44771525 2.44771525,4 3,4 C3.55228475,4 4,4.44771525 4,5 C4,5.55228475 3.55228475,6 3,6 Z M3,10 C2.44771525,10 2,9.55228475 2,9 C2,8.44771525 2.44771525,8 3,8 C3.55228475,8 4,8.44771525 4,9 C4,9.55228475 3.55228475,10 3,10 Z M7,2 C6.44771525,2 6,1.55228475 6,1 C6,0.44771525 6.44771525,0 7,0 C7.55228475,0 8,0.44771525 8,1 C8,1.55228475 7.55228475,2 7,2 Z M7,6 C6.44771525,6 6,5.55228475 6,5 C6,4.44771525 6.44771525,4 7,4 C7.55228475,4 8,4.44771525 8,5 C8,5.55228475 7.55228475,6 7,6 Z M7,10 C6.44771525,10 6,9.55228475 6,9 C6,8.44771525 6.44771525,8 7,8 C7.55228475,8 8,8.44771525 8,9 C8,9.55228475 7.55228475,10 7,10 Z" />
        </svg>
      </button>
    </div>
  )
}
