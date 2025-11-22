'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { NovelEditor } from '@/components/editor/NovelEditor'
import { serializeBlocks } from '@/lib/serializers/blocks-to-react'
import type { BlockDocument } from '@/lib/blocks/types'
import type { KnowledgePage } from '@/payload-types'

interface PageEditorProps {
  page: KnowledgePage
  canEdit: boolean
  onSave: (content: BlockDocument) => Promise<void>
}

export function PageEditor({ page, canEdit, onSave }: PageEditorProps) {
  // Ensure initial content is pure JSON without MongoDB properties
  const initialContent = useMemo(
    () => JSON.parse(JSON.stringify(page.content)) as BlockDocument,
    [page.content]
  )

  const [isEditing, setIsEditing] = useState(false)
  const [content, setContent] = useState<BlockDocument>(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef<string>(JSON.stringify(initialContent))
  const currentContentRef = useRef<BlockDocument>(initialContent)

  const handleEdit = useCallback(() => {
    if (canEdit) {
      setIsEditing(true)
    }
  }, [canEdit])

  // Auto-save function
  const performSave = useCallback(async (contentToSave: BlockDocument) => {
    const contentString = JSON.stringify(contentToSave)

    // Don't save if content hasn't changed
    if (contentString === lastSavedContentRef.current) {
      return
    }

    setSaveStatus('saving')
    setIsSaving(true)

    try {
      // Ensure we pass pure JSON without MongoDB-specific properties
      const pureContent = JSON.parse(contentString) as BlockDocument
      await onSave(pureContent)
      lastSavedContentRef.current = contentString
      setSaveStatus('saved')
    } catch (error) {
      console.error('Failed to save:', error)
      setSaveStatus('unsaved')
      alert('Failed to save page. Your changes may be lost.')
    } finally {
      setIsSaving(false)
    }
  }, [onSave])

  // Handle content changes with debounced auto-save
  const handleChange = useCallback((newContent: BlockDocument) => {
    setContent(newContent)
    currentContentRef.current = newContent
    setSaveStatus('unsaved')

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout for auto-save (2 seconds)
    saveTimeoutRef.current = setTimeout(() => {
      performSave(newContent)
    }, 2000)
  }, [performSave])

  // Save on unmount or when exiting edit mode
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const handleCancel = useCallback(() => {
    // Clear any pending saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    setContent(initialContent)
    currentContentRef.current = initialContent
    setIsEditing(false)
    setSaveStatus('saved')
  }, [initialContent])

  const handleExit = useCallback(async () => {
    // Save any pending changes before exiting
    if (saveStatus === 'unsaved') {
      await performSave(currentContentRef.current)
    }
    setIsEditing(false)
  }, [saveStatus, performSave])

  // Handle Escape key to exit editing
  useEffect(() => {
    if (!isEditing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExit()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, handleExit])

  if (isEditing) {
    return (
      <div className="page-editor">
        <div className="mb-3 flex items-center justify-end">
          <div className="flex items-center gap-2">
            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-600 dark:text-green-500 flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Saved
              </span>
            )}
            {saveStatus === 'unsaved' && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
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

  // Check if content is empty
  const isEmpty = !content.content || content.content.length === 0 ||
    (content.content.length === 1 &&
     content.content[0].type === 'paragraph' &&
     (!content.content[0].content || content.content[0].content.length === 0))

  return (
    <div
      className={`
        page-content relative group
        rounded-lg border border-transparent
        transition-all duration-200
        min-h-[400px]
        ${canEdit ? 'cursor-pointer hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50' : ''}
      `}
      onClick={canEdit ? handleEdit : undefined}
    >
      <div className="px-12 py-8">
        {isEmpty && canEdit ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] text-center">
            <div className="mb-4 text-gray-400 dark:text-gray-500">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              Start writing
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
              Click here to start editing. Press <kbd className="px-2 py-1 text-xs font-semibold bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded">/ </kbd> for commands
            </p>
          </div>
        ) : (
          <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none dark:prose-invert">
            {serializeBlocks(content)}
          </div>
        )}
      </div>
      {canEdit && !isEmpty && (
        <button
          className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={handleEdit}
          aria-label="Edit page"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </button>
      )}
    </div>
  )
}
