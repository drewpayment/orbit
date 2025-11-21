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
