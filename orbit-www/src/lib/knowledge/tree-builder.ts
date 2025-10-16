import type { KnowledgePage } from '@/payload-types'
import type { PageTreeNode } from '@/components/features/knowledge/types'

export function buildPageTree(pages: KnowledgePage[]): PageTreeNode[] {
  // Create lookup map
  const pageMap = new Map<string, PageTreeNode>()
  const rootNodes: PageTreeNode[] = []
  
  // First pass: create all nodes
  pages.forEach(page => {
    const node: PageTreeNode = {
      id: page.id,
      title: page.title,
      slug: page.slug,
      status: page.status,
      sortOrder: page.sortOrder || 0,
      children: [],
      parentId: typeof page.parentPage === 'string' ? page.parentPage : null,
    }
    pageMap.set(page.id, node)
  })
  
  // Second pass: build hierarchy
  pageMap.forEach(node => {
    if (node.parentId && pageMap.has(node.parentId)) {
      const parent = pageMap.get(node.parentId)!
      parent.children.push(node)
    } else {
      rootNodes.push(node)
    }
  })
  
  // Sort nodes at each level by sortOrder
  const sortNodes = (nodes: PageTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder)
    nodes.forEach(node => {
      if (node.children.length > 0) {
        sortNodes(node.children)
      }
    })
  }
  
  sortNodes(rootNodes)
  
  return rootNodes
}

export function findPagePath(
  tree: PageTreeNode[],
  targetId: string,
  path: string[] = []
): string[] | null {
  for (const node of tree) {
    const currentPath = [...path, node.id]
    
    if (node.id === targetId) {
      return currentPath
    }
    
    if (node.children.length > 0) {
      const found = findPagePath(node.children, targetId, currentPath)
      if (found) return found
    }
  }
  
  return null
}
