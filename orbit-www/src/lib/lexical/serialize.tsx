import React from 'react'

interface LexicalNode {
  type: string
  text?: string
  tag?: string
  format?: number
  url?: string
  target?: string
  listType?: string
  children?: LexicalNode[]
}

interface LexicalContent {
  root?: {
    children?: LexicalNode[]
  }
}

// Basic serializer - expand based on Lexical node types used
export function serializeLexical(content: LexicalContent): React.ReactNode {
  if (!content || !content.root || !content.root.children) {
    return null
  }
  
  return serializeChildren(content.root.children)
}

function serializeChildren(children: LexicalNode[]): React.ReactNode {
  return children.map((node, index) => serializeNode(node, index))
}

function serializeNode(node: LexicalNode, index: number): React.ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p key={index}>
          {node.children && serializeChildren(node.children)}
        </p>
      )
    
    case 'heading': {
      const tag = node.tag || 'h1'
      const children = node.children && serializeChildren(node.children)
      
      switch (tag) {
        case 'h1':
          return <h1 key={index}>{children}</h1>
        case 'h2':
          return <h2 key={index}>{children}</h2>
        case 'h3':
          return <h3 key={index}>{children}</h3>
        case 'h4':
          return <h4 key={index}>{children}</h4>
        case 'h5':
          return <h5 key={index}>{children}</h5>
        case 'h6':
          return <h6 key={index}>{children}</h6>
        default:
          return <h2 key={index}>{children}</h2>
      }
    }
    
    case 'text': {
      let text: React.ReactNode = node.text || ''
      
      if (node.format) {
        if (node.format & 1) { // Bold
          text = <strong>{text}</strong>
        }
        if (node.format & 2) { // Italic
          text = <em>{text}</em>
        }
        if (node.format & 8) { // Code
          text = <code>{text}</code>
        }
      }
      
      return <React.Fragment key={index}>{text}</React.Fragment>
    }
    
    case 'list': {
      const ListTag = node.listType === 'number' ? 'ol' : 'ul'
      return (
        <ListTag key={index}>
          {node.children && serializeChildren(node.children)}
        </ListTag>
      )
    }
    
    case 'listitem':
      return (
        <li key={index}>
          {node.children && serializeChildren(node.children)}
        </li>
      )
    
    case 'link':
      return (
        <a key={index} href={node.url || '#'} target={node.target || '_self'}>
          {node.children && serializeChildren(node.children)}
        </a>
      )
    
    case 'code':
      return (
        <pre key={index}>
          <code>{node.children && serializeChildren(node.children)}</code>
        </pre>
      )
    
    case 'linebreak':
      return <br key={index} />
    
    case 'quote':
      return (
        <blockquote key={index}>
          {node.children && serializeChildren(node.children)}
        </blockquote>
      )
    
    default:
      // For unknown node types, render children if they exist, or null
      console.warn(`Unknown Lexical node type: ${node.type}`, node)
      if (node.children && node.children.length > 0) {
        return <div key={index}>{serializeChildren(node.children)}</div>
      }
      if (node.text) {
        return <span key={index}>{node.text}</span>
      }
      return null
  }
}
