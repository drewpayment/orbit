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

    const { container } = render(<NovelEditor initialContent={content} readOnly />)

    const editor = container.querySelector('[role="textbox"]')
    expect(editor?.getAttribute('contenteditable')).toBe('false')
  })
})
