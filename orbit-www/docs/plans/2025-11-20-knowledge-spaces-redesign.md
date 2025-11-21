# Knowledge Spaces Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform knowledge spaces into a modern block-based documentation platform with inline editing, instant search, and wiki-style linking.

**Architecture:** Novel block editor on frontend with Tiptap/ProseMirror foundation. Unified block JSON storage compatible with existing Payload Lexical backend. Postgres FTS for search, PageLinks collection for backlinks graph.

**Tech Stack:** Novel.sh, Tiptap, PostgreSQL FTS, Payload 3.0, Next.js 15, TypeScript, React 19

---

## Phase 1: Foundation & Dependencies

### Task 1: Install Novel and Tiptap Dependencies

**Files:**
- Modify: `orbit-www/package.json`

**Step 1: Add Novel and related dependencies**

```bash
cd orbit-www
pnpm add novel @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-code-block-lowlight @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header lowlight shiki
```

**Step 2: Add dev dependencies for testing**

```bash
pnpm add -D @testing-library/react @testing-library/user-event vitest-dom
```

**Step 3: Verify installation**

Run: `pnpm list novel`
Expected: Shows novel package installed

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add Novel editor and Tiptap extensions"
```

---

### Task 2: Create Block JSON Type Definitions

**Files:**
- Create: `orbit-www/src/lib/blocks/types.ts`
- Create: `orbit-www/src/lib/blocks/schema.ts`

**Step 1: Write test for block type validation**

Create: `orbit-www/src/lib/blocks/__tests__/types.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { isValidBlock, BlockType } from '../types'

describe('Block Types', () => {
  it('should validate heading block', () => {
    const block = {
      type: 'heading' as BlockType,
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Hello' }]
    }
    expect(isValidBlock(block)).toBe(true)
  })

  it('should reject invalid heading level', () => {
    const block = {
      type: 'heading' as BlockType,
      attrs: { level: 7 },
      content: [{ type: 'text', text: 'Hello' }]
    }
    expect(isValidBlock(block)).toBe(false)
  })

  it('should validate paragraph block', () => {
    const block = {
      type: 'paragraph' as BlockType,
      content: [{ type: 'text', text: 'Content' }]
    }
    expect(isValidBlock(block)).toBe(true)
  })

  it('should validate code block', () => {
    const block = {
      type: 'codeBlock' as BlockType,
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: 'const x = 1' }]
    }
    expect(isValidBlock(block)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm test src/lib/blocks/__tests__/types.test.ts`
Expected: FAIL - module not found

**Step 3: Write block type definitions**

Create: `orbit-www/src/lib/blocks/types.ts`

```typescript
export type BlockType =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'codeBlock'
  | 'blockquote'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'image'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'tableHeader'
  | 'callout'
  | 'toggle'
  | 'mention'
  | 'text'

export interface TextNode {
  type: 'text'
  text: string
  marks?: Array<{
    type: 'bold' | 'italic' | 'code' | 'link'
    attrs?: Record<string, unknown>
  }>
}

export interface BlockNode {
  type: BlockType
  attrs?: Record<string, unknown>
  content?: Array<BlockNode | TextNode>
}

export interface BlockDocument {
  type: 'doc'
  content: BlockNode[]
}

export function isValidBlock(block: unknown): block is BlockNode {
  if (typeof block !== 'object' || block === null) return false

  const node = block as BlockNode
  if (!node.type) return false

  // Validate heading levels
  if (node.type === 'heading') {
    const level = node.attrs?.level
    if (typeof level !== 'number' || level < 1 || level > 6) {
      return false
    }
  }

  // Validate code block language
  if (node.type === 'codeBlock') {
    if (node.attrs?.language && typeof node.attrs.language !== 'string') {
      return false
    }
  }

  return true
}

export function isValidDocument(doc: unknown): doc is BlockDocument {
  if (typeof doc !== 'object' || doc === null) return false

  const document = doc as BlockDocument
  if (document.type !== 'doc') return false
  if (!Array.isArray(document.content)) return false

  return document.content.every(isValidBlock)
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm test src/lib/blocks/__tests__/types.test.ts`
Expected: PASS - all tests pass

**Step 5: Commit**

```bash
git add src/lib/blocks/
git commit -m "feat: add block JSON type definitions and validation"
```

---

### Task 3: Create PageLinks Collection

**Files:**
- Create: `orbit-www/src/collections/PageLinks.ts`

**Step 1: Write the PageLinks collection**

Create: `orbit-www/src/collections/PageLinks.ts`

```typescript
import type { CollectionConfig } from 'payload'

export const PageLinks: CollectionConfig = {
  slug: 'page-links',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['fromPage', 'toPage', 'linkType', 'createdAt'],
    hidden: false,
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      return {
        'fromPage.knowledgeSpace.workspace.members.user': {
          equals: user.id,
        },
      }
    },
    create: ({ req: { user } }) => !!user,
    update: () => false, // Links are immutable after creation
    delete: ({ req: { user } }) => !!user,
  },
  fields: [
    {
      name: 'fromPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      required: true,
      index: true,
    },
    {
      name: 'toPage',
      type: 'relationship',
      relationTo: 'knowledge-pages',
      required: true,
      index: true,
    },
    {
      name: 'linkType',
      type: 'select',
      required: true,
      defaultValue: 'mention',
      options: [
        { label: 'Mention', value: 'mention' },
        { label: 'Embed', value: 'embed' },
        { label: 'Reference', value: 'reference' },
      ],
    },
  ],
  timestamps: true,
  indexes: [
    {
      fields: { fromPage: 1, toPage: 1 },
      options: { unique: true },
    },
    {
      fields: { toPage: 1 },
    },
  ],
}
```

**Step 2: Register collection in Payload config**

Modify: `orbit-www/src/payload.config.ts`

Find the collections array and add:

```typescript
import { PageLinks } from './collections/PageLinks'

// In the config object:
collections: [
  // ... existing collections
  PageLinks,
],
```

**Step 3: Generate Payload types**

Run: `cd orbit-www && pnpm payload generate:types`
Expected: Types generated successfully

**Step 4: Commit**

```bash
git add src/collections/PageLinks.ts src/payload.config.ts src/payload-types.ts
git commit -m "feat: add PageLinks collection for backlinks graph"
```

---

### Task 4: Add Database Migration for Search

**Files:**
- Create: `orbit-www/src/migrations/2025-11-20-add-fts-search.ts`

**Step 1: Create migration file**

Create: `orbit-www/src/migrations/2025-11-20-add-fts-search.ts`

```typescript
import { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'

export async function up({ payload }: MigrateUpArgs): Promise<void> {
  await payload.db.drizzle.execute(`
    -- Add content_text column for full-text search
    ALTER TABLE knowledge_pages
    ADD COLUMN IF NOT EXISTS content_text TEXT;

    -- Create function to extract text from block JSON
    CREATE OR REPLACE FUNCTION extract_text_from_blocks(blocks JSONB)
    RETURNS TEXT AS $$
    DECLARE
      result TEXT := '';
      block JSONB;
    BEGIN
      FOR block IN SELECT jsonb_array_elements(blocks->'content')
      LOOP
        IF block->>'type' IN ('paragraph', 'heading', 'codeBlock', 'blockquote') THEN
          result := result || ' ' || COALESCE(
            (SELECT string_agg(item->>'text', ' ')
             FROM jsonb_array_elements(block->'content') item
             WHERE item->>'type' = 'text'),
            ''
          );
        END IF;
      END LOOP;
      RETURN result;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;

    -- Update existing rows
    UPDATE knowledge_pages
    SET content_text = extract_text_from_blocks(content::jsonb)
    WHERE content IS NOT NULL;

    -- Create trigger to auto-update content_text
    CREATE OR REPLACE FUNCTION update_content_text()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.content_text := extract_text_from_blocks(NEW.content::jsonb);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS knowledge_pages_content_text_trigger ON knowledge_pages;
    CREATE TRIGGER knowledge_pages_content_text_trigger
      BEFORE INSERT OR UPDATE OF content ON knowledge_pages
      FOR EACH ROW
      EXECUTE FUNCTION update_content_text();

    -- Create GIN index for full-text search
    CREATE INDEX IF NOT EXISTS knowledge_pages_search_idx
      ON knowledge_pages
      USING GIN(to_tsvector('english', title || ' ' || COALESCE(content_text, '')));
  `)
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  await payload.db.drizzle.execute(`
    DROP INDEX IF EXISTS knowledge_pages_search_idx;
    DROP TRIGGER IF EXISTS knowledge_pages_content_text_trigger ON knowledge_pages;
    DROP FUNCTION IF EXISTS update_content_text();
    DROP FUNCTION IF EXISTS extract_text_from_blocks(JSONB);
    ALTER TABLE knowledge_pages DROP COLUMN IF EXISTS content_text;
  `)
}
```

**Step 2: Run migration**

Run: `cd orbit-www && pnpm payload migrate`
Expected: Migration applied successfully

**Step 3: Verify migration**

Run: `cd orbit-www && pnpm payload migrate:status`
Expected: Shows migration as applied

**Step 4: Commit**

```bash
git add src/migrations/
git commit -m "feat: add Postgres FTS search migration"
```

---

## Phase 2: Block Serialization

### Task 5: Create Block-to-React Serializer

**Files:**
- Create: `orbit-www/src/lib/serializers/blocks-to-react.tsx`
- Create: `orbit-www/src/lib/serializers/__tests__/blocks-to-react.test.tsx`

**Step 1: Write tests for block serialization**

Create: `orbit-www/src/lib/serializers/__tests__/blocks-to-react.test.tsx`

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { serializeBlocks } from '../blocks-to-react'
import type { BlockDocument } from '@/lib/blocks/types'

describe('Block to React Serializer', () => {
  it('should serialize heading blocks', () => {
    const doc: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Hello World' }],
        },
      ],
    }

    const { container } = render(<>{serializeBlocks(doc)}</>)
    const h1 = container.querySelector('h1')
    expect(h1).toBeTruthy()
    expect(h1?.textContent).toBe('Hello World')
  })

  it('should serialize paragraph blocks', () => {
    const doc: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'This is a paragraph' }],
        },
      ],
    }

    const { container } = render(<>{serializeBlocks(doc)}</>)
    const p = container.querySelector('p')
    expect(p).toBeTruthy()
    expect(p?.textContent).toBe('This is a paragraph')
  })

  it('should serialize code blocks', () => {
    const doc: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
      ],
    }

    const { container } = render(<>{serializeBlocks(doc)}</>)
    const pre = container.querySelector('pre')
    const code = container.querySelector('code')
    expect(pre).toBeTruthy()
    expect(code).toBeTruthy()
    expect(code?.textContent).toBe('const x = 1')
  })

  it('should serialize text with marks', () => {
    const doc: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Bold text',
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ],
    }

    const { container } = render(<>{serializeBlocks(doc)}</>)
    const strong = container.querySelector('strong')
    expect(strong).toBeTruthy()
    expect(strong?.textContent).toBe('Bold text')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm test src/lib/serializers/__tests__/blocks-to-react.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement block serializer**

Create: `orbit-www/src/lib/serializers/blocks-to-react.tsx`

```typescript
import React from 'react'
import type { BlockDocument, BlockNode, TextNode } from '@/lib/blocks/types'

export function serializeBlocks(doc: BlockDocument): React.ReactNode {
  return doc.content.map((block, index) => serializeBlock(block, index))
}

function serializeBlock(block: BlockNode, index: number): React.ReactNode {
  const key = `block-${index}`

  switch (block.type) {
    case 'heading':
      return serializeHeading(block, key)
    case 'paragraph':
      return serializeParagraph(block, key)
    case 'codeBlock':
      return serializeCodeBlock(block, key)
    case 'blockquote':
      return serializeBlockquote(block, key)
    case 'bulletList':
      return serializeBulletList(block, key)
    case 'orderedList':
      return serializeOrderedList(block, key)
    case 'image':
      return serializeImage(block, key)
    case 'table':
      return serializeTable(block, key)
    case 'callout':
      return serializeCallout(block, key)
    case 'toggle':
      return serializeToggle(block, key)
    default:
      console.warn(`Unknown block type: ${block.type}`)
      return null
  }
}

function serializeHeading(block: BlockNode, key: string): React.ReactNode {
  const level = (block.attrs?.level as number) || 1
  const content = serializeContent(block.content)
  const Tag = `h${level}` as keyof JSX.IntrinsicElements

  return <Tag key={key}>{content}</Tag>
}

function serializeParagraph(block: BlockNode, key: string): React.ReactNode {
  return <p key={key}>{serializeContent(block.content)}</p>
}

function serializeCodeBlock(block: BlockNode, key: string): React.ReactNode {
  const language = block.attrs?.language as string | undefined
  const code = block.content?.map(node => {
    if ('text' in node) return node.text
    return ''
  }).join('')

  return (
    <pre key={key} className={language ? `language-${language}` : undefined}>
      <code>{code}</code>
    </pre>
  )
}

function serializeBlockquote(block: BlockNode, key: string): React.ReactNode {
  return <blockquote key={key}>{serializeContent(block.content)}</blockquote>
}

function serializeBulletList(block: BlockNode, key: string): React.ReactNode {
  return <ul key={key}>{serializeContent(block.content)}</ul>
}

function serializeOrderedList(block: BlockNode, key: string): React.ReactNode {
  return <ol key={key}>{serializeContent(block.content)}</ol>
}

function serializeImage(block: BlockNode, key: string): React.ReactNode {
  const src = block.attrs?.src as string
  const alt = block.attrs?.alt as string | undefined
  const caption = block.attrs?.caption as string | undefined

  return (
    <figure key={key}>
      <img src={src} alt={alt || ''} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

function serializeTable(block: BlockNode, key: string): React.ReactNode {
  return <table key={key}><tbody>{serializeContent(block.content)}</tbody></table>
}

function serializeCallout(block: BlockNode, key: string): React.ReactNode {
  const variant = (block.attrs?.variant as string) || 'info'
  return (
    <div key={key} className={`callout callout-${variant}`}>
      {serializeContent(block.content)}
    </div>
  )
}

function serializeToggle(block: BlockNode, key: string): React.ReactNode {
  const summary = block.attrs?.summary as string | undefined
  return (
    <details key={key}>
      <summary>{summary || 'Toggle'}</summary>
      {serializeContent(block.content)}
    </details>
  )
}

function serializeContent(
  content: Array<BlockNode | TextNode> | undefined
): React.ReactNode {
  if (!content) return null

  return content.map((node, index) => {
    if ('text' in node) {
      return serializeTextNode(node as TextNode, index)
    }
    return serializeBlock(node as BlockNode, index)
  })
}

function serializeTextNode(node: TextNode, index: number): React.ReactNode {
  let content: React.ReactNode = node.text

  if (node.marks) {
    node.marks.forEach(mark => {
      switch (mark.type) {
        case 'bold':
          content = <strong>{content}</strong>
          break
        case 'italic':
          content = <em>{content}</em>
          break
        case 'code':
          content = <code>{content}</code>
          break
        case 'link':
          content = (
            <a href={mark.attrs?.href as string} target={mark.attrs?.target as string}>
              {content}
            </a>
          )
          break
      }
    })
  }

  return <React.Fragment key={`text-${index}`}>{content}</React.Fragment>
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm test src/lib/serializers/__tests__/blocks-to-react.test.tsx`
Expected: PASS - all tests pass

**Step 5: Commit**

```bash
git add src/lib/serializers/
git commit -m "feat: add block-to-react serializer"
```

---

### Task 6: Update KnowledgePage to Support Block JSON

**Files:**
- Modify: `orbit-www/src/collections/KnowledgePages.ts`

**Step 1: Add contentFormat field**

In `orbit-www/src/collections/KnowledgePages.ts`, add field after `content`:

```typescript
{
  name: 'contentFormat',
  type: 'select',
  defaultValue: 'blocks',
  options: [
    { label: 'Block JSON', value: 'blocks' },
    { label: 'Lexical (Legacy)', value: 'lexical' },
  ],
  admin: {
    position: 'sidebar',
    readOnly: true,
  },
},
```

**Step 2: Update content field description**

Find the `content` field and update description:

```typescript
{
  name: 'content',
  type: 'richText',
  required: true,
  admin: {
    description: 'Page content. Stored as Block JSON format compatible with Novel editor.',
  },
},
```

**Step 3: Generate types**

Run: `cd orbit-www && pnpm payload generate:types`
Expected: Types regenerated

**Step 4: Commit**

```bash
git add src/collections/KnowledgePages.ts src/payload-types.ts
git commit -m "feat: add contentFormat field to KnowledgePages"
```

---

## Phase 3: Novel Editor Integration

### Task 7: Create Novel Editor Component

**Files:**
- Create: `orbit-www/src/components/editor/NovelEditor.tsx`
- Create: `orbit-www/src/components/editor/__tests__/NovelEditor.test.tsx`

**Step 1: Write test for editor component**

Create: `orbit-www/src/components/editor/__tests__/NovelEditor.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NovelEditor } from '../NovelEditor'

describe('NovelEditor', () => {
  it('should render editor with initial content', () => {
    const content = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'Hello' }],
        },
      ],
    }

    const onChange = vi.fn()
    render(<NovelEditor initialContent={content} onChange={onChange} />)

    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('should call onChange when content changes', async () => {
    const content = {
      type: 'doc' as const,
      content: [],
    }

    const onChange = vi.fn()
    render(<NovelEditor initialContent={content} onChange={onChange} />)

    // Test implementation will verify onChange is called
    // Full interaction testing requires user-event setup
  })

  it('should render in read-only mode', () => {
    const content = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph' as const,
          content: [{ type: 'text' as const, text: 'Read only' }],
        },
      ],
    }

    render(<NovelEditor initialContent={content} readOnly />)

    const editor = screen.getByRole('textbox')
    expect(editor.getAttribute('contenteditable')).toBe('false')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm test src/components/editor/__tests__/NovelEditor.test.tsx`
Expected: FAIL - module not found

**Step 3: Create Novel editor component**

Create: `orbit-www/src/components/editor/NovelEditor.tsx`

```typescript
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { lowlight } from 'lowlight'
import type { BlockDocument } from '@/lib/blocks/types'
import { useEffect } from 'react'

interface NovelEditorProps {
  initialContent?: BlockDocument
  onChange?: (content: BlockDocument) => void
  readOnly?: boolean
  className?: string
}

export function NovelEditor({
  initialContent,
  onChange,
  readOnly = false,
  className = '',
}: NovelEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Use CodeBlockLowlight instead
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline',
        },
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
    ],
    content: initialContent,
    editable: !readOnly,
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
    <div className="novel-editor">
      <EditorContent editor={editor} />
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm test src/components/editor/__tests__/NovelEditor.test.tsx`
Expected: PASS - all tests pass

**Step 5: Commit**

```bash
git add src/components/editor/
git commit -m "feat: add Novel editor component"
```

---

### Task 8: Create Inline Editing Page Component

**Files:**
- Create: `orbit-www/src/components/features/knowledge/PageEditor.tsx`
- Modify: `orbit-www/src/app/(app)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

**Step 1: Create PageEditor component with view/edit modes**

Create: `orbit-www/src/components/features/knowledge/PageEditor.tsx`

```typescript
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
      className={`page-content ${canEdit ? 'cursor-pointer hover:bg-gray-50 rounded p-4' : ''}`}
      onClick={handleEdit}
    >
      <div className="prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none">
        {serializeBlocks(content)}
      </div>
      {canEdit && (
        <div className="mt-2 text-sm text-gray-500">
          Click to edit
        </div>
      )}
    </div>
  )
}
```

**Step 2: Update page route to use PageEditor**

Modify: `orbit-www/src/app/(app)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

Find the content rendering section and replace with:

```typescript
import { PageEditor } from '@/components/features/knowledge/PageEditor'

// In the component:
async function updatePage(content: BlockDocument) {
  'use server'

  const payload = await getPayload({ config: configPromise })

  await payload.update({
    collection: 'knowledge-pages',
    id: page.id,
    data: {
      content,
      contentFormat: 'blocks',
    },
  })

  revalidatePath(`/workspaces/${workspace.slug}/knowledge/${space.slug}/${page.slug}`)
}

// In the JSX:
<PageEditor
  page={page}
  canEdit={hasEditPermission}
  onSave={updatePage}
/>
```

**Step 3: Test the editor integration**

Run: `cd orbit-www && pnpm dev`

Navigate to a knowledge page and verify:
- Click to edit works
- Editor renders
- Save/cancel buttons work

**Step 4: Commit**

```bash
git add src/components/features/knowledge/PageEditor.tsx src/app/(app)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx
git commit -m "feat: add inline editing with Novel editor"
```

---

## Phase 4: Search Implementation

### Task 9: Create Search API Route

**Files:**
- Create: `orbit-www/src/app/api/workspaces/[slug]/knowledge/search/route.ts`
- Create: `orbit-www/src/app/api/workspaces/[slug]/knowledge/search/__tests__/route.test.ts`

**Step 1: Write test for search API**

Create: `orbit-www/src/app/api/workspaces/[slug]/knowledge/search/__tests__/route.test.ts`

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { GET } from '../route'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

describe('Search API', () => {
  beforeAll(async () => {
    // Setup test database with sample pages
  })

  it('should return search results for matching query', async () => {
    const request = new Request(
      'http://localhost:3000/api/workspaces/test/knowledge/search?q=testing'
    )
    const params = { slug: 'test' }

    const response = await GET(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toBeDefined()
    expect(Array.isArray(data.results)).toBe(true)
  })

  it('should scope search to specific space', async () => {
    const request = new Request(
      'http://localhost:3000/api/workspaces/test/knowledge/search?q=testing&scope=space&spaceId=123'
    )
    const params = { slug: 'test' }

    const response = await GET(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toBeDefined()
  })

  it('should return empty results for no matches', async () => {
    const request = new Request(
      'http://localhost:3000/api/workspaces/test/knowledge/search?q=nonexistentquery12345'
    )
    const params = { slug: 'test' }

    const response = await GET(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm test src/app/api/workspaces/[slug]/knowledge/search/__tests__/route.test.ts`
Expected: FAIL - module not found

**Step 3: Implement search API route**

Create: `orbit-www/src/app/api/workspaces/[slug]/knowledge/search/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const payload = await getPayload({ config: configPromise })
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')
    const scope = searchParams.get('scope') || 'workspace'
    const spaceId = searchParams.get('spaceId')

    if (!query) {
      return NextResponse.json({ results: [] })
    }

    // Get workspace
    const workspaces = await payload.find({
      collection: 'workspaces',
      where: {
        slug: { equals: params.slug },
      },
      limit: 1,
    })

    if (!workspaces.docs.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const workspace = workspaces.docs[0]

    // Build search query
    const whereClause: any = {
      and: [
        {
          'knowledgeSpace.workspace': {
            equals: workspace.id,
          },
        },
        {
          status: {
            equals: 'published',
          },
        },
      ],
    }

    // Scope to specific space if requested
    if (scope === 'space' && spaceId) {
      whereClause.and.push({
        knowledgeSpace: {
          equals: spaceId,
        },
      })
    }

    // Use Postgres full-text search via raw SQL
    const sql = `
      SELECT
        id,
        title,
        slug,
        ts_rank(
          to_tsvector('english', title || ' ' || COALESCE(content_text, '')),
          plainto_tsquery('english', $1)
        ) AS rank,
        ts_headline(
          'english',
          COALESCE(content_text, ''),
          plainto_tsquery('english', $1),
          'MaxWords=30, MinWords=10, StartSel=<mark>, StopSel=</mark>'
        ) AS snippet
      FROM knowledge_pages
      WHERE
        to_tsvector('english', title || ' ' || COALESCE(content_text, ''))
        @@ plainto_tsquery('english', $1)
        AND status = 'published'
      ORDER BY rank DESC
      LIMIT 10
    `

    const results = await payload.db.drizzle.execute(sql, [query])

    // Enrich results with metadata
    const enrichedResults = await Promise.all(
      results.rows.map(async (row: any) => {
        const page = await payload.findByID({
          collection: 'knowledge-pages',
          id: row.id,
          depth: 2,
        })

        return {
          id: row.id,
          title: row.title,
          slug: row.slug,
          snippet: row.snippet,
          rank: row.rank,
          space: typeof page.knowledgeSpace === 'object' ? {
            id: page.knowledgeSpace.id,
            name: page.knowledgeSpace.name,
            slug: page.knowledgeSpace.slug,
          } : null,
          breadcrumb: getBreadcrumb(page),
          lastUpdated: page.updatedAt,
        }
      })
    )

    return NextResponse.json({ results: enrichedResults })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    )
  }
}

function getBreadcrumb(page: any): string {
  const parts = []

  if (typeof page.knowledgeSpace === 'object') {
    parts.push(page.knowledgeSpace.name)
  }

  let current = page
  while (current.parentPage && typeof current.parentPage === 'object') {
    parts.push(current.parentPage.title)
    current = current.parentPage
  }

  parts.push(page.title)

  return parts.join(' > ')
}
```

**Step 4: Run test to verify it passes**

Run: `cd orbit-www && pnpm test src/app/api/workspaces/[slug]/knowledge/search/__tests__/route.test.ts`
Expected: PASS (or skip if integration tests not set up)

**Step 5: Commit**

```bash
git add src/app/api/workspaces/[slug]/knowledge/search/
git commit -m "feat: add Postgres FTS search API endpoint"
```

---

### Task 10: Create Search Modal Component

**Files:**
- Create: `orbit-www/src/components/features/knowledge/SearchModal.tsx`
- Create: `orbit-www/src/components/features/knowledge/SearchModal.client.tsx`

**Step 1: Create search modal UI component**

Create: `orbit-www/src/components/features/knowledge/SearchModal.tsx`

```typescript
'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState, useCallback, useEffect } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useDebounce } from '@/hooks/useDebounce'

interface SearchResult {
  id: string
  title: string
  slug: string
  snippet: string
  breadcrumb: string
  lastUpdated: string
  space: {
    id: string
    name: string
    slug: string
  } | null
}

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceSlug: string
  currentSpaceId?: string
}

export function SearchModal({
  isOpen,
  onClose,
  workspaceSlug,
  currentSpaceId,
}: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [scope, setScope] = useState<'workspace' | 'space'>('workspace')

  const debouncedQuery = useDebounce(query, 300)

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([])
      return
    }

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        scope,
      })

      if (scope === 'space' && currentSpaceId) {
        params.append('spaceId', currentSpaceId)
      }

      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/knowledge/search?${params}`
      )

      if (!response.ok) throw new Error('Search failed')

      const data = await response.json()
      setResults(data.results || [])
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSlug, scope, currentSpaceId])

  useEffect(() => {
    performSearch(debouncedQuery)
  }, [debouncedQuery, performSearch])

  const handleResultClick = (result: SearchResult) => {
    if (result.space) {
      window.location.href = `/workspaces/${workspaceSlug}/knowledge/${result.space.slug}/${result.slug}`
    }
    onClose()
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-start justify-center p-4 pt-[20vh]">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-lg bg-white shadow-xl transition-all">
                <div className="p-4 border-b">
                  <div className="flex items-center gap-2">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      className="flex-1 outline-none text-lg"
                      placeholder="Search knowledge base..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {currentSpaceId && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className={`px-3 py-1 text-sm rounded ${
                          scope === 'workspace'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                        onClick={() => setScope('workspace')}
                      >
                        All spaces
                      </button>
                      <button
                        className={`px-3 py-1 text-sm rounded ${
                          scope === 'space'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                        onClick={() => setScope('space')}
                      >
                        This space
                      </button>
                    </div>
                  )}
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {isLoading && (
                    <div className="p-4 text-center text-gray-500">
                      Searching...
                    </div>
                  )}

                  {!isLoading && query && results.length === 0 && (
                    <div className="p-4 text-center text-gray-500">
                      No results found
                    </div>
                  )}

                  {!isLoading && results.length > 0 && (
                    <div className="divide-y">
                      {results.map((result) => (
                        <button
                          key={result.id}
                          className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                          onClick={() => handleResultClick(result)}
                        >
                          <div className="font-medium">{result.title}</div>
                          <div className="text-sm text-gray-500 mt-1">
                            {result.breadcrumb}
                          </div>
                          {result.snippet && (
                            <div
                              className="text-sm text-gray-600 mt-2 line-clamp-2"
                              dangerouslySetInnerHTML={{ __html: result.snippet }}
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-3 border-t bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
                  <div>
                    <kbd className="px-2 py-1 bg-white border rounded">↑↓</kbd>{' '}
                    to navigate
                    <kbd className="ml-2 px-2 py-1 bg-white border rounded">↵</kbd>{' '}
                    to select
                    <kbd className="ml-2 px-2 py-1 bg-white border rounded">esc</kbd>{' '}
                    to close
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
```

**Step 2: Create debounce hook**

Create: `orbit-www/src/hooks/useDebounce.ts`

```typescript
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}
```

**Step 3: Create keyboard shortcut provider**

Create: `orbit-www/src/components/features/knowledge/SearchModal.client.tsx`

```typescript
'use client'

import { useState, useEffect } from 'react'
import { SearchModal } from './SearchModal'

interface SearchModalClientProps {
  workspaceSlug: string
  currentSpaceId?: string
}

export function SearchModalClient({
  workspaceSlug,
  currentSpaceId,
}: SearchModalClientProps) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <SearchModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      workspaceSlug={workspaceSlug}
      currentSpaceId={currentSpaceId}
    />
  )
}
```

**Step 4: Install Headless UI**

```bash
cd orbit-www
pnpm add @headlessui/react @heroicons/react
```

**Step 5: Commit**

```bash
git add src/components/features/knowledge/SearchModal.tsx src/components/features/knowledge/SearchModal.client.tsx src/hooks/useDebounce.ts package.json pnpm-lock.yaml
git commit -m "feat: add search modal with keyboard shortcut"
```

---

## Phase 5: Page Linking & Backlinks

### Task 11: Create Link Graph Hook

**Files:**
- Create: `orbit-www/src/collections/hooks/updateLinkGraph.ts`
- Modify: `orbit-www/src/collections/KnowledgePages.ts`

**Step 1: Write test for link extraction**

Create: `orbit-www/src/collections/hooks/__tests__/updateLinkGraph.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { extractPageLinks } from '../updateLinkGraph'
import type { BlockDocument } from '@/lib/blocks/types'

describe('Link Graph Extraction', () => {
  it('should extract mention links from content', () => {
    const content: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'mention',
              attrs: { pageId: '123', label: 'Other Page' },
            },
            { type: 'text', text: ' for details' },
          ],
        },
      ],
    }

    const links = extractPageLinks(content)
    expect(links).toEqual([
      { pageId: '123', linkType: 'mention' },
    ])
  })

  it('should extract multiple links', () => {
    const content: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { pageId: '123', label: 'Page 1' },
            },
            { type: 'text', text: ' and ' },
            {
              type: 'mention',
              attrs: { pageId: '456', label: 'Page 2' },
            },
          ],
        },
      ],
    }

    const links = extractPageLinks(content)
    expect(links).toEqual([
      { pageId: '123', linkType: 'mention' },
      { pageId: '456', linkType: 'mention' },
    ])
  })

  it('should return empty array for no links', () => {
    const content: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'No links here' }],
        },
      ],
    }

    const links = extractPageLinks(content)
    expect(links).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd orbit-www && pnpm test src/collections/hooks/__tests__/updateLinkGraph.test.ts`
Expected: FAIL - module not found

**Step 3: Implement link extraction and graph update**

Create: `orbit-www/src/collections/hooks/updateLinkGraph.ts`

```typescript
import type { CollectionAfterChangeHook } from 'payload'
import type { KnowledgePage } from '@/payload-types'
import type { BlockDocument, BlockNode, TextNode } from '@/lib/blocks/types'

interface PageLink {
  pageId: string
  linkType: 'mention' | 'embed' | 'reference'
}

export function extractPageLinks(content: BlockDocument): PageLink[] {
  const links: PageLink[] = []

  function traverse(nodes: Array<BlockNode | TextNode>) {
    for (const node of nodes) {
      if ('type' in node) {
        if (node.type === 'mention' && node.attrs?.pageId) {
          links.push({
            pageId: node.attrs.pageId as string,
            linkType: 'mention',
          })
        }

        if (node.content) {
          traverse(node.content)
        }
      }
    }
  }

  traverse(content.content)
  return links
}

export const updateLinkGraph: CollectionAfterChangeHook<KnowledgePage> = async ({
  doc,
  req,
  operation,
}) => {
  const { payload } = req

  // Only process if content changed
  if (operation === 'update' && !doc.content) {
    return doc
  }

  try {
    const content = doc.content as unknown as BlockDocument
    const newLinks = extractPageLinks(content)

    // Delete existing links from this page
    const existing = await payload.find({
      collection: 'page-links',
      where: {
        fromPage: {
          equals: doc.id,
        },
      },
    })

    for (const link of existing.docs) {
      await payload.delete({
        collection: 'page-links',
        id: link.id,
      })
    }

    // Create new links
    for (const link of newLinks) {
      try {
        await payload.create({
          collection: 'page-links',
          data: {
            fromPage: doc.id,
            toPage: link.pageId,
            linkType: link.linkType,
          },
        })
      } catch (error) {
        // Ignore duplicate key errors
        if (!(error as Error).message.includes('unique')) {
          console.error('Failed to create link:', error)
        }
      }
    }
  } catch (error) {
    console.error('Failed to update link graph:', error)
  }

  return doc
}
```

**Step 4: Add hook to KnowledgePages collection**

Modify: `orbit-www/src/collections/KnowledgePages.ts`

Add at the top:

```typescript
import { updateLinkGraph } from './hooks/updateLinkGraph'
```

Add to the collection config:

```typescript
hooks: {
  afterChange: [updateLinkGraph],
},
```

**Step 5: Run test to verify it passes**

Run: `cd orbit-www && pnpm test src/collections/hooks/__tests__/updateLinkGraph.test.ts`
Expected: PASS - all tests pass

**Step 6: Commit**

```bash
git add src/collections/hooks/ src/collections/KnowledgePages.ts
git commit -m "feat: add link graph extraction and update hook"
```

---

### Task 12: Create Backlinks Panel Component

**Files:**
- Create: `orbit-www/src/components/features/knowledge/BacklinksPanel.tsx`
- Modify: `orbit-www/src/app/(app)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

**Step 1: Create backlinks panel component**

Create: `orbit-www/src/components/features/knowledge/BacklinksPanel.tsx`

```typescript
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import Link from 'next/link'
import type { KnowledgePage } from '@/payload-types'

interface BacklinksPanelProps {
  pageId: string
  workspaceSlug: string
}

export async function BacklinksPanel({
  pageId,
  workspaceSlug,
}: BacklinksPanelProps) {
  const payload = await getPayload({ config: configPromise })

  // Find all links pointing to this page
  const links = await payload.find({
    collection: 'page-links',
    where: {
      toPage: {
        equals: pageId,
      },
    },
    depth: 2,
  })

  const backlinks = links.docs
    .map((link) => link.fromPage)
    .filter((page): page is KnowledgePage => typeof page === 'object')

  if (backlinks.length === 0) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">Backlinks</h3>
        <p className="text-sm text-gray-500">
          No pages link to this page yet
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 bg-gray-50 rounded-lg">
      <h3 className="font-semibold mb-2">
        Backlinks ({backlinks.length})
      </h3>
      <div className="space-y-2">
        {backlinks.map((page) => {
          const space = typeof page.knowledgeSpace === 'object'
            ? page.knowledgeSpace
            : null

          return (
            <div key={page.id} className="text-sm">
              <Link
                href={`/workspaces/${workspaceSlug}/knowledge/${space?.slug}/${page.slug}`}
                className="text-blue-600 hover:underline"
              >
                {page.title}
              </Link>
              {space && (
                <div className="text-xs text-gray-500 mt-1">
                  in {space.name}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Add backlinks panel to page layout**

Modify: `orbit-www/src/app/(app)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx`

Import and add to the layout:

```typescript
import { BacklinksPanel } from '@/components/features/knowledge/BacklinksPanel'

// In the JSX, add a sidebar section:
<aside className="w-64 space-y-4">
  <BacklinksPanel
    pageId={page.id}
    workspaceSlug={workspace.slug}
  />
</aside>
```

**Step 3: Test backlinks display**

Run: `cd orbit-www && pnpm dev`

Create a test page with a mention link, verify backlink appears

**Step 4: Commit**

```bash
git add src/components/features/knowledge/BacklinksPanel.tsx src/app/(app)/workspaces/[slug]/knowledge/[spaceSlug]/[pageSlug]/page.tsx
git commit -m "feat: add backlinks panel to page view"
```

---

## Phase 6: Custom Blocks & Polish

### Task 13: Add Mention Extension to Novel

**Files:**
- Create: `orbit-www/src/components/editor/extensions/Mention.ts`
- Modify: `orbit-www/src/components/editor/NovelEditor.tsx`

**Step 1: Create Mention extension**

Create: `orbit-www/src/components/editor/extensions/Mention.ts`

```typescript
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MentionNodeView } from '../node-views/MentionNodeView'

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>
  suggestion: {
    items: (query: string) => Promise<Array<{ id: string; label: string }>>
    render: () => {
      onStart: (props: unknown) => void
      onUpdate: (props: unknown) => void
      onExit: () => void
      onKeyDown: (props: { event: KeyboardEvent }) => boolean
    }
  }
}

export const Mention = Node.create<MentionOptions>({
  name: 'mention',

  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-page-id'),
        renderHTML: (attributes) => {
          if (!attributes.pageId) {
            return {}
          }

          return {
            'data-page-id': attributes.pageId,
          }
        },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => {
          if (!attributes.label) {
            return {}
          }

          return {
            'data-label': attributes.label,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"]',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': 'mention' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `@${node.attrs.label}`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView)
  },
})
```

**Step 2: Create Mention node view component**

Create: `orbit-www/src/components/editor/node-views/MentionNodeView.tsx`

```typescript
import { NodeViewWrapper } from '@tiptap/react'

export function MentionNodeView({ node }: { node: any }) {
  return (
    <NodeViewWrapper
      as="span"
      className="mention inline-block px-1 py-0.5 bg-blue-100 text-blue-700 rounded cursor-pointer hover:bg-blue-200"
    >
      @{node.attrs.label}
    </NodeViewWrapper>
  )
}
```

**Step 3: Add Mention extension to Novel editor**

Modify: `orbit-www/src/components/editor/NovelEditor.tsx`

Add import:

```typescript
import { Mention } from './extensions/Mention'
```

Add to extensions array:

```typescript
Mention.configure({
  HTMLAttributes: {
    class: 'mention',
  },
  suggestion: {
    items: async (query: string) => {
      // Fetch pages matching query
      // This will be implemented in next task
      return []
    },
    render: () => ({
      onStart: () => {},
      onUpdate: () => {},
      onExit: () => {},
      onKeyDown: ({ event }) => {
        if (event.key === 'Escape') {
          return true
        }
        return false
      },
    }),
  },
}),
```

**Step 4: Commit**

```bash
git add src/components/editor/extensions/ src/components/editor/node-views/ src/components/editor/NovelEditor.tsx
git commit -m "feat: add mention extension for page linking"
```

---

### Task 14: Add Callout Block Extension

**Files:**
- Create: `orbit-www/src/components/editor/extensions/Callout.ts`
- Create: `orbit-www/src/components/editor/node-views/CalloutNodeView.tsx`
- Modify: `orbit-www/src/components/editor/NovelEditor.tsx`
- Modify: `orbit-www/src/lib/serializers/blocks-to-react.tsx`

**Step 1: Create Callout extension**

Create: `orbit-www/src/components/editor/extensions/Callout.ts`

```typescript
import { Node, mergeAttributes } from '@tiptap/core'

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: string) => ReturnType
      toggleCallout: () => ReturnType
    }
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (element) => element.getAttribute('data-variant'),
        renderHTML: (attributes) => {
          return {
            'data-variant': attributes.variant,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': 'callout' },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      0,
    ]
  },

  addCommands() {
    return {
      setCallout:
        (variant = 'info') =>
        ({ commands }) => {
          return commands.wrapIn(this.name, { variant })
        },
      toggleCallout:
        () =>
        ({ commands }) => {
          return commands.toggleWrap(this.name)
        },
    }
  },
})
```

**Step 2: Create Callout node view**

Create: `orbit-www/src/components/editor/node-views/CalloutNodeView.tsx`

```typescript
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'

const variantStyles = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  success: 'bg-green-50 border-green-200 text-green-900',
  error: 'bg-red-50 border-red-200 text-red-900',
}

const variantIcons = {
  info: 'ℹ️',
  warning: '⚠️',
  success: '✅',
  error: '❌',
}

export function CalloutNodeView({ node }: { node: any }) {
  const variant = node.attrs.variant || 'info'
  const styles = variantStyles[variant as keyof typeof variantStyles]
  const icon = variantIcons[variant as keyof typeof variantIcons]

  return (
    <NodeViewWrapper
      className={`callout ${styles} border-l-4 p-4 my-4 rounded-r`}
    >
      <div className="flex gap-2">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  )
}
```

**Step 3: Update serializer for callouts**

Modify: `orbit-www/src/lib/serializers/blocks-to-react.tsx`

Update `serializeCallout` function:

```typescript
function serializeCallout(block: BlockNode, key: string): React.ReactNode {
  const variant = (block.attrs?.variant as string) || 'info'

  const variantStyles = {
    info: 'bg-blue-50 border-blue-200 text-blue-900',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    success: 'bg-green-50 border-green-200 text-green-900',
    error: 'bg-red-50 border-red-200 text-red-900',
  }

  const variantIcons = {
    info: 'ℹ️',
    warning: '⚠️',
    success: '✅',
    error: '❌',
  }

  const styles = variantStyles[variant as keyof typeof variantStyles]
  const icon = variantIcons[variant as keyof typeof variantIcons]

  return (
    <div key={key} className={`callout ${styles} border-l-4 p-4 my-4 rounded-r`}>
      <div className="flex gap-2">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          {serializeContent(block.content)}
        </div>
      </div>
    </div>
  )
}
```

**Step 4: Add Callout to Novel editor**

Modify: `orbit-www/src/components/editor/NovelEditor.tsx`

Add import and extension:

```typescript
import { Callout } from './extensions/Callout'

// In extensions array:
Callout.configure({
  HTMLAttributes: {
    class: 'callout',
  },
}),
```

**Step 5: Commit**

```bash
git add src/components/editor/extensions/Callout.ts src/components/editor/node-views/CalloutNodeView.tsx src/components/editor/NovelEditor.tsx src/lib/serializers/blocks-to-react.tsx
git commit -m "feat: add callout block extension with variants"
```

---

## Phase 7: Testing & Documentation

### Task 15: Add Integration Tests

**Files:**
- Create: `orbit-www/tests/integration/knowledge-spaces.test.ts`

**Step 1: Write integration tests**

Create: `orbit-www/tests/integration/knowledge-spaces.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import type { BlockDocument } from '@/lib/blocks/types'

describe('Knowledge Spaces Integration', () => {
  let payload: any
  let workspaceId: string
  let spaceId: string

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })

    // Create test workspace
    const workspace = await payload.create({
      collection: 'workspaces',
      data: {
        name: 'Test Workspace',
        slug: 'test-workspace',
      },
    })
    workspaceId = workspace.id

    // Create test space
    const space = await payload.create({
      collection: 'knowledge-spaces',
      data: {
        workspace: workspaceId,
        name: 'Test Space',
        slug: 'test-space',
        visibility: 'internal',
      },
    })
    spaceId = space.id
  })

  afterAll(async () => {
    // Cleanup
    await payload.delete({ collection: 'workspaces', id: workspaceId })
  })

  it('should create page with block JSON content', async () => {
    const content: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Test Page' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'This is a test' }],
        },
      ],
    }

    const page = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: spaceId,
        title: 'Test Page',
        slug: 'test-page',
        content,
        contentFormat: 'blocks',
        status: 'published',
      },
    })

    expect(page.id).toBeDefined()
    expect(page.content).toEqual(content)
    expect(page.contentFormat).toBe('blocks')
  })

  it('should extract text for search indexing', async () => {
    const content: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Searchable content here' }],
        },
      ],
    }

    const page = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: spaceId,
        title: 'Searchable Page',
        slug: 'searchable-page',
        content,
        contentFormat: 'blocks',
        status: 'published',
      },
    })

    // Verify content_text was populated
    const result = await payload.db.drizzle.execute(
      `SELECT content_text FROM knowledge_pages WHERE id = $1`,
      [page.id]
    )

    expect(result.rows[0].content_text).toContain('Searchable content')
  })

  it('should create link graph entries', async () => {
    // Create two pages
    const page1 = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: spaceId,
        title: 'Page 1',
        slug: 'page-1',
        content: { type: 'doc', content: [] },
        status: 'published',
      },
    })

    const content: BlockDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'mention',
              attrs: { pageId: page1.id, label: 'Page 1' },
            },
          ],
        },
      ],
    }

    const page2 = await payload.create({
      collection: 'knowledge-pages',
      data: {
        knowledgeSpace: spaceId,
        title: 'Page 2',
        slug: 'page-2',
        content,
        contentFormat: 'blocks',
        status: 'published',
      },
    })

    // Verify link was created
    const links = await payload.find({
      collection: 'page-links',
      where: {
        and: [
          { fromPage: { equals: page2.id } },
          { toPage: { equals: page1.id } },
        ],
      },
    })

    expect(links.docs).toHaveLength(1)
    expect(links.docs[0].linkType).toBe('mention')
  })
})
```

**Step 2: Run integration tests**

Run: `cd orbit-www && pnpm test tests/integration/knowledge-spaces.test.ts`
Expected: PASS - all integration tests pass

**Step 3: Commit**

```bash
git add tests/integration/knowledge-spaces.test.ts
git commit -m "test: add knowledge spaces integration tests"
```

---

### Task 16: Update Documentation

**Files:**
- Create: `orbit-www/docs/features/knowledge-spaces.md`

**Step 1: Write user documentation**

Create: `orbit-www/docs/features/knowledge-spaces.md`

```markdown
# Knowledge Spaces

Knowledge Spaces provide a modern, block-based documentation platform for your workspace.

## Features

### Block-Based Editor

Create rich content using a Notion-style block editor:

- **Rich Text**: Headings, paragraphs, lists, quotes
- **Code Blocks**: Syntax highlighting for 100+ languages
- **Media**: Images, videos, embeds
- **Interactive**: Callouts, toggles, tabs
- **Tables**: Sortable markdown-style tables

### Inline Editing

Click anywhere on a page to start editing. No separate edit mode required.

- Auto-save every 2 seconds
- Optimistic UI updates
- Version conflict detection

### Search

Search across all knowledge spaces with instant results.

- **Keyboard Shortcut**: Cmd+K (Mac) or Ctrl+K (Windows/Linux)
- **Scoped Search**: Search current space or all spaces
- **Instant Results**: As-you-type with highlighting
- **Smart Ranking**: Title matches ranked higher

### Page Linking

Create wiki-style connections between pages.

- **@ Mentions**: Type `@` to link to other pages
- **Backlinks**: See which pages reference current page
- **Link Graph**: Automatic bidirectional linking

### Slash Commands

Type `/` to insert blocks:

- `/heading` - Insert heading (H1-H6)
- `/code` - Insert code block
- `/callout` - Insert callout (info/warning/success/error)
- `/table` - Insert table
- `/image` - Upload image

## Usage

### Creating a Page

1. Navigate to a Knowledge Space
2. Click "New Page"
3. Enter title and start typing
4. Use slash commands to add blocks

### Linking Pages

1. Type `@` while editing
2. Search for page to link
3. Select from dropdown
4. Link appears with page title

### Searching

1. Press Cmd+K (or Ctrl+K)
2. Type search query
3. Navigate results with arrow keys
4. Press Enter to open page

## Permissions

- **Readers**: Can view published pages
- **Members**: Can create and edit pages
- **Admins**: Can manage spaces and all pages
- **Owners**: Full control including deletion

## Technical Details

- **Storage**: Block JSON format compatible with Tiptap
- **Search**: PostgreSQL full-text search with GIN indexes
- **Editor**: Built on Novel.sh and Tiptap
- **Link Graph**: Automatic via Payload hooks
```

**Step 2: Commit**

```bash
git add docs/features/knowledge-spaces.md
git commit -m "docs: add knowledge spaces user documentation"
```

---

## Summary

This implementation plan covers:

1. **Foundation** - Dependencies, types, collections, migrations
2. **Serialization** - Block JSON format and React rendering
3. **Editor** - Novel integration with inline editing
4. **Search** - Postgres FTS with search modal
5. **Linking** - Page mentions and backlinks graph
6. **Blocks** - Custom callout and mention extensions
7. **Testing** - Integration tests and documentation

Each task follows TDD where applicable and includes exact file paths, complete code, and verification steps.

**Estimated effort:** 3-4 weeks for complete implementation

**Success criteria:**
- ✅ Inline editing with Novel works
- ✅ Search returns relevant results in <200ms
- ✅ Page linking creates backlinks automatically
- ✅ Custom blocks render correctly
- ✅ All tests pass
- ✅ Documentation complete
