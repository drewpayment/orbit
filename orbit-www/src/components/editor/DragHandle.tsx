'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface DragHandleProps {
  editor: Editor
}

export function DragHandle({ editor }: DragHandleProps) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isOverHandle, setIsOverHandle] = useState(false)
  const dragHandleRef = useRef<HTMLDivElement>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const editorElement = editor.view.dom as HTMLElement

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      if (!target.closest) return

      // Check if hovering over the drag handle
      if (target.closest('.drag-handle-wrapper')) {
        setIsOverHandle(true)
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current)
          hideTimeoutRef.current = null
        }
        return
      }

      setIsOverHandle(false)

      // Find the closest block-level element
      const prosemirrorNode = target.closest('.ProseMirror')
      if (!prosemirrorNode) {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = setTimeout(() => setElement(null), 100)
        return
      }

      // Find block element
      const blockElement = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th')

      if (blockElement && blockElement instanceof HTMLElement) {
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current)
          hideTimeoutRef.current = null
        }
        setElement(blockElement)
      } else if (!isOverHandle) {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = setTimeout(() => setElement(null), 100)
      }
    }

    const handleMouseLeave = () => {
      if (!isOverHandle) {
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = setTimeout(() => setElement(null), 100)
      }
    }

    editorElement.addEventListener('mousemove', handleMouseMove)
    editorElement.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      editorElement.removeEventListener('mousemove', handleMouseMove)
      editorElement.removeEventListener('mouseleave', handleMouseLeave)
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    }
  }, [editor, isOverHandle])

  useEffect(() => {
    if (element) {
      element.classList.add('is-hovered')
    }

    return () => {
      if (element) {
        element.classList.remove('is-hovered')
      }
    }
  }, [element])

  if (!element) {
    return null
  }

  const editorWrapper = element.closest('.novel-editor')
  if (!editorWrapper) return null

  const editorRect = editorWrapper.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  const top = elementRect.top - editorRect.top
  const left = elementRect.left - editorRect.left - 32

  return (
    <div
      ref={dragHandleRef}
      className="drag-handle-wrapper absolute z-50"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        pointerEvents: 'auto',
      }}
      contentEditable={false}
      onMouseEnter={() => {
        setIsOverHandle(true)
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current)
          hideTimeoutRef.current = null
        }
      }}
      onMouseLeave={() => {
        setIsOverHandle(false)
        hideTimeoutRef.current = setTimeout(() => setElement(null), 100)
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        // Make the element draggable
        element.setAttribute('draggable', 'true')
        element.ondragstart = (dragEvent) => {
          dragEvent.dataTransfer!.effectAllowed = 'move'
          dragEvent.dataTransfer!.setData('text/html', element.outerHTML)
          element.classList.add('opacity-50')
        }
        element.ondragend = () => {
          element.classList.remove('opacity-50')
          element.removeAttribute('draggable')
        }
      }}
    >
      <button
        type="button"
        className="
          drag-handle-button
          flex items-center justify-center
          w-5 h-5
          rounded
          hover:bg-gray-200 dark:hover:bg-gray-700
          text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
          cursor-grab active:cursor-grabbing
          transition-all
        "
        title="Drag to move"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 10 10"
          width="12"
          height="12"
          fill="currentColor"
        >
          <path d="M3,2 C2.44771525,2 2,1.55228475 2,1 C2,0.44771525 2.44771525,0 3,0 C3.55228475,0 4,0.44771525 4,1 C4,1.55228475 3.55228475,2 3,2 Z M3,6 C2.44771525,6 2,5.55228475 2,5 C2,4.44771525 2.44771525,4 3,4 C3.55228475,4 4,4.44771525 4,5 C4,5.55228475 3.55228475,6 3,6 Z M3,10 C2.44771525,10 2,9.55228475 2,9 C2,8.44771525 2.44771525,8 3,8 C3.55228475,8 4,8.44771525 4,9 C4,9.55228475 3.55228475,10 3,10 Z M7,2 C6.44771525,2 6,1.55228475 6,1 C6,0.44771525 6.44771525,0 7,0 C7.55228475,0 8,0.44771525 8,1 C8,1.55228475 7.55228475,2 7,2 Z M7,6 C6.44771525,6 6,5.55228475 6,5 C6,4.44771525 6.44771525,4 7,4 C7.55228475,4 8,4.44771525 8,5 C8,5.55228475 7.55228475,6 7,6 Z M7,10 C6.44771525,10 6,9.55228475 6,9 C6,8.44771525 6.44771525,8 7,8 C7.55228475,8 4,8.44771525 8,9 C8,9.55228475 7.55228475,10 7,10 Z" />
        </svg>
      </button>
    </div>
  )
}
