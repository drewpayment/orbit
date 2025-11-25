import type { KnowledgePage } from '@/payload-types'
import type { PageTreeNode } from '@/components/features/knowledge/types'

export function buildPageTree(pages: KnowledgePage[]): PageTreeNode[] {
  // Create lookup map
  const pageMap = new Map<string, PageTreeNode>()
  const rootNodes: PageTreeNode[] = []

  // First pass: create all nodes
  pages.forEach(page => {
    // Handle both string IDs and populated objects for parentPage
    let parentId: string | null = null
    if (page.parentPage) {
      if (typeof page.parentPage === 'string') {
        parentId = page.parentPage
      } else if (typeof page.parentPage === 'object' && page.parentPage.id) {
        parentId = page.parentPage.id
      }
    }

    const node: PageTreeNode = {
      id: page.id,
      title: page.title,
      slug: page.slug,
      status: page.status,
      sortOrder: page.sortOrder || 0,
      children: [],
      parentId,
    }
    pageMap.set(page.id, node)
  })

  // Second pass: build hierarchy with circular reference detection
  const processedNodes = new Set<string>()

  pageMap.forEach(node => {
    // Detect circular references
    const visited = new Set<string>()
    let currentId: string | null = node.parentId
    let isCircular = false

    while (currentId) {
      if (visited.has(currentId)) {
        isCircular = true
        console.error(`Circular reference detected for page ${node.id} (${node.title})`)
        break
      }
      visited.add(currentId)
      const parent = pageMap.get(currentId)
      currentId = parent?.parentId || null
    }

    // If parent exists and no circular reference, add to parent's children
    // Otherwise, add to root
    if (!isCircular && node.parentId && pageMap.has(node.parentId)) {
      const parent = pageMap.get(node.parentId)!
      parent.children.push(node)
    } else {
      if (isCircular) {
        // Reset parent to null for circular references
        node.parentId = null
      }
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
