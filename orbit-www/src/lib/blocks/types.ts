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
