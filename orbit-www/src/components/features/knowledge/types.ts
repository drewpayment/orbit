import type { KnowledgePage, KnowledgeSpace } from '@/payload-types'

export interface PageTreeNode {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published' | 'archived'
  sortOrder: number
  children: PageTreeNode[]
  parentId: string | null
}

export interface SpaceNavigatorProps {
  knowledgeSpace: KnowledgeSpace
  pages: KnowledgePage[]
  currentPageId?: string
  onPageSelect?: (pageId: string) => void
  workspaceSlug?: string
}

export interface PageTreeNodeProps {
  node: PageTreeNode
  currentPageId?: string
  depth: number
  onPageSelect?: (pageId: string) => void
  workspaceSlug?: string
  spaceSlug?: string
}
