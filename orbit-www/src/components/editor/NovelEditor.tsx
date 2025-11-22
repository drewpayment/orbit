'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Placeholder from '@tiptap/extension-placeholder'
import { common, createLowlight } from 'lowlight'
import type { BlockDocument } from '@/lib/blocks/types'
import { useEffect } from 'react'

const lowlight = createLowlight(common)

interface NovelEditorProps {
  initialContent?: BlockDocument
  onChange?: (content: BlockDocument) => void
  onBlur?: () => void
  readOnly?: boolean
  className?: string
}

export function NovelEditor({
  initialContent,
  onChange,
  onBlur,
  readOnly = false,
  className = '',
}: NovelEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Use CodeBlockLowlight instead
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false, // Prevent SSR hydration mismatches
    autofocus: !readOnly, // Auto-focus when editable
    onUpdate: ({ editor }) => {
      if (onChange) {
        const json = editor.getJSON() as BlockDocument
        onChange(json)
      }
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm sm:prose lg:prose-lg xl:prose-xl focus:outline-none ${className}`,
        role: 'textbox',
      },
      onBlur: () => {
        if (onBlur) {
          onBlur()
        }
      },
    },
  })

  useEffect(() => {
    if (editor && initialContent) {
      const currentContent = editor.getJSON()
      if (JSON.stringify(currentContent) !== JSON.stringify(initialContent)) {
        editor.commands.setContent(initialContent)
      }
    }
  }, [editor, initialContent])

  if (!editor) {
    return <div className="animate-pulse h-32 bg-gray-100 rounded" />
  }

  return (
    <div className="novel-editor border border-gray-200 rounded-lg p-4 min-h-[300px] bg-white dark:bg-gray-900 dark:border-gray-700">
      <EditorContent editor={editor} />
    </div>
  )
}
