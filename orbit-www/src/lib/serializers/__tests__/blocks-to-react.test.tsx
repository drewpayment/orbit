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
