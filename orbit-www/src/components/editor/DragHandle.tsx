'use client'

import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'

interface DragHandleProps {
  editor: Editor
}

export function DragHandle({ editor }: DragHandleProps) {
  const dragHandleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editorElement = editor.view.dom as HTMLElement
    const proseMirrorElement = editorElement.querySelector('.ProseMirror') as HTMLElement

    if (!proseMirrorElement || !dragHandleRef.current) return

    const dragHandle = dragHandleRef.current

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // Find the closest block element
      let blockElement: HTMLElement | null = null
      let current: HTMLElement | null = target

      while (current && current !== proseMirrorElement) {
        if (
          current.nodeName === 'P' ||
          current.nodeName.match(/^H[1-6]$/) ||
          current.nodeName === 'LI' ||
          current.nodeName === 'BLOCKQUOTE' ||
          current.nodeName === 'PRE' ||
          current.nodeName === 'DIV' && current.hasAttribute('data-type')
        ) {
          blockElement = current
          break
        }
        current = current.parentElement
      }

      if (blockElement && proseMirrorElement.contains(blockElement)) {
        const rect = blockElement.getBoundingClientRect()
        const containerRect = proseMirrorElement.getBoundingClientRect()

        dragHandle.style.top = `${rect.top - containerRect.top}px`
        dragHandle.style.opacity = '1'
        dragHandle.dataset.blockElement = 'true'

        // Store reference to the block for dragging
        dragHandle.onclick = () => {
          blockElement?.setAttribute('draggable', 'true')
          blockElement?.focus()
        }
      } else {
        dragHandle.style.opacity = '0'
      }
    }

    const handleMouseLeave = () => {
      dragHandle.style.opacity = '0'
    }

    proseMirrorElement.addEventListener('mousemove', handleMouseMove)
    proseMirrorElement.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      proseMirrorElement.removeEventListener('mousemove', handleMouseMove)
      proseMirrorElement.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [editor])

  return (
    <div
      ref={dragHandleRef}
      className="drag-handle-wrapper absolute left-0 opacity-0 transition-opacity pointer-events-auto"
      style={{
        top: 0,
        marginLeft: '-40px',
        zIndex: 50,
      }}
      contentEditable={false}
    >
      <button
        className="
          drag-handle flex items-center justify-center
          w-6 h-6 rounded hover:bg-gray-200 dark:hover:bg-gray-700
          text-gray-400 hover:text-gray-600 dark:hover:text-gray-300
          cursor-grab active:cursor-grabbing
          transition-colors
        "
        type="button"
        title="Drag to reorder"
        draggable
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="3" cy="3" r="1.5" />
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="3" cy="13" r="1.5" />
          <circle cx="9" cy="3" r="1.5" />
          <circle cx="9" cy="8" r="1.5" />
          <circle cx="9" cy="13" r="1.5" />
        </svg>
      </button>
    </div>
  )
}
