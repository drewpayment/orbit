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
