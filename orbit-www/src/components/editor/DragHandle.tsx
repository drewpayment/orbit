'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface DragHandleProps {
  editor: Editor
}

export function DragHandle({ editor }: DragHandleProps) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const dragHandleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editorElement = editor.view.dom as HTMLElement
    const editorWrapper = editorElement.closest('.novel-editor') as HTMLElement

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Don't update if we're hovering over the drag handle itself
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
          left: blockRect.left - wrapperRect.left - 40,
        })
      }
    }

    const handleMouseLeave = (event: MouseEvent) => {
      // Check if we're leaving to the drag handle
      const relatedTarget = event.relatedTarget as HTMLElement
      if (dragHandleRef.current?.contains(relatedTarget)) {
        return
      }

      setElement(null)
    }

    editorElement.addEventListener('mousemove', handleMouseMove)
    editorElement.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      editorElement.removeEventListener('mousemove', handleMouseMove)
      editorElement.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [editor])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!element) return

    // Make the element draggable
    element.setAttribute('draggable', 'true')

    element.ondragstart = (dragEvent) => {
      if (!dragEvent.dataTransfer) return

      dragEvent.dataTransfer.effectAllowed = 'move'
      dragEvent.dataTransfer.setData('text/html', element.outerHTML)

      // Add visual feedback
      element.style.opacity = '0.5'
    }

    element.ondragend = () => {
      element.style.opacity = ''
      element.removeAttribute('draggable')
    }

    // Trigger drag on the element
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))
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
      onMouseDown={handleMouseDown}
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
