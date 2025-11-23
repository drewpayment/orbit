'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { NovelEditor } from '@/components/editor/NovelEditor'
import { serializeBlocks } from '@/lib/serializers/blocks-to-react'
import type { BlockDocument } from '@/lib/blocks/types'
import type { KnowledgePage } from '@/payload-types'
import { toast } from 'sonner'

interface PageEditorProps {
  page: KnowledgePage
  canEdit: boolean
  onSave: (content: BlockDocument) => Promise<void>
  onStatusChange?: (status: 'saved' | 'saving' | 'unsaved') => void
}

export function PageEditor({ page, canEdit, onSave, onStatusChange }: PageEditorProps) {
  // Ensure initial content is pure JSON without MongoDB properties
  const initialContent = useMemo(
    () => JSON.parse(JSON.stringify(page.content)) as BlockDocument,
    [page.content]
  )

  const [content, setContent] = useState<BlockDocument>(initialContent)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Helper to update save status and notify parent
  const updateSaveStatus = useCallback((status: 'saved' | 'saving' | 'unsaved') => {
    setSaveStatus(status)
    onStatusChange?.(status)
  }, [onStatusChange])
  const lastSavedContentRef = useRef<string>(JSON.stringify(initialContent))
  const currentContentRef = useRef<BlockDocument>(initialContent)

  // Auto-save function
  const performSave = useCallback(async (contentToSave: BlockDocument) => {
    const contentString = JSON.stringify(contentToSave)

    // Don't save if content hasn't changed
    if (contentString === lastSavedContentRef.current) {
      return
    }

    updateSaveStatus('saving')

    try {
      const pureContent = JSON.parse(contentString) as BlockDocument
      await onSave(pureContent)
      lastSavedContentRef.current = contentString
      updateSaveStatus('saved')
    } catch (error) {
      console.error('Failed to save:', error)
      updateSaveStatus('unsaved')
      toast.error('Failed to save page', {
        description: error instanceof Error ? error.message : 'Please try again or your changes may be lost.',
      })
    }
  }, [onSave, updateSaveStatus])

  // Handle content changes with debounced auto-save
  const handleChange = useCallback((newContent: BlockDocument) => {
    setContent(newContent)
    currentContentRef.current = newContent
    updateSaveStatus('unsaved')

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout for auto-save (2 seconds)
    saveTimeoutRef.current = setTimeout(() => {
      performSave(newContent)
    }, 2000)
  }, [performSave, updateSaveStatus])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // If user can't edit, show read-only view
  if (!canEdit) {
    return (
      <div className="page-content px-12 py-8">
        <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none dark:prose-invert font-serif-body">
          {serializeBlocks(content)}
        </div>
      </div>
    )
  }

  // Always-on editor for users who can edit
  return (
    <div className="page-editor">
      <NovelEditor
        initialContent={content}
        onChange={handleChange}
        onBlur={() => {
          // Save immediately on blur if there are unsaved changes
          if (saveStatus === 'unsaved' && saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current)
            performSave(currentContentRef.current)
          }
        }}
      />
    </div>
  )
}
