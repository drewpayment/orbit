import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PageEditor } from './PageEditor'
import type { KnowledgePage } from '@/payload-types'

// Mock NovelEditor component
vi.mock('@/components/editor/NovelEditor', () => ({
  NovelEditor: ({ initialContent, onChange }: any) => (
    <div data-testid="novel-editor">
      <div data-testid="editor-content">{JSON.stringify(initialContent)}</div>
    </div>
  ),
}))

// Mock serializeBlocks
vi.mock('@/lib/serializers/blocks-to-react', () => ({
  serializeBlocks: (content: any) => (
    <div data-testid="serialized-content">{JSON.stringify(content)}</div>
  ),
}))

describe('PageEditor - Always-On Mode', () => {
  const mockPage: Partial<KnowledgePage> = {
    id: 'test-page',
    title: 'Test Page',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Test content' }],
        },
      ],
    },
  }

  const mockOnSave = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('should always render NovelEditor when canEdit is true', () => {
    render(
      <PageEditor
        page={mockPage as KnowledgePage}
        canEdit={true}
        onSave={mockOnSave}
      />
    )

    expect(screen.getByTestId('novel-editor')).toBeInTheDocument()
  })

  it('should render read-only view when canEdit is false', () => {
    render(
      <PageEditor
        page={mockPage as KnowledgePage}
        canEdit={false}
        onSave={mockOnSave}
      />
    )

    // Should show serialized content, not editor
    expect(screen.queryByTestId('novel-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('serialized-content')).toBeInTheDocument()
  })

  it('should show empty state when content is empty and canEdit is true', () => {
    const emptyPage = {
      ...mockPage,
      content: { type: 'doc', content: [] },
    }

    render(
      <PageEditor
        page={emptyPage as KnowledgePage}
        canEdit={true}
        onSave={mockOnSave}
      />
    )

    expect(screen.getByText(/start writing/i)).toBeInTheDocument()
  })
})
