'use client'

import { useState, useCallback } from 'react'
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
  const [isEditing, setIsEditing] = useState(false)
  const [content, setContent] = useState<BlockDocument>(
    page.content as BlockDocument
  )
  const [isSaving, setIsSaving] = useState(false)

  const handleEdit = useCallback(() => {
    if (canEdit) {
      setIsEditing(true)
    }
  }, [canEdit])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await onSave(content)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save:', error)
      alert('Failed to save page. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }, [content, onSave])

  const handleCancel = useCallback(() => {
    setContent(page.content as BlockDocument)
    setIsEditing(false)
  }, [page.content])

  const handleChange = useCallback((newContent: BlockDocument) => {
    setContent(newContent)
  }, [])

  if (isEditing) {
    return (
      <div className="page-editor">
        <div className="mb-4 flex gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        <NovelEditor
          initialContent={content}
          onChange={handleChange}
        />
      </div>
    )
  }

  return (
    <div
      className="page-content relative group"
      onClick={canEdit ? handleEdit : undefined}
    >
      <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none">
        {serializeBlocks(content)}
      </div>
      {canEdit && (
        <button
          className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
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
