'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Plus, Search, FileText } from 'lucide-react'
import { PageTreeNode } from './PageTreeNode'
import { buildPageTree } from '@/lib/knowledge/tree-builder'
import type { SpaceNavigatorProps } from './types'

export function SpaceNavigator({
  knowledgeSpace,
  pages,
  currentPageId,
  onPageSelect,
  workspaceSlug,
}: SpaceNavigatorProps) {
  const tree = useMemo(() => buildPageTree(pages), [pages])
  
  const publishedPages = pages.filter(p => p.status === 'published').length
  const draftPages = pages.filter(p => p.status === 'draft').length
  
  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{knowledgeSpace.name}</CardTitle>
          <Button size="sm" variant="ghost">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        {knowledgeSpace.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {knowledgeSpace.description}
          </p>
        )}
      </CardHeader>
      
      <Separator />
      
      <CardContent className="flex-1 overflow-auto py-4">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FileText className="h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-4">
              No pages yet. Create your first page to get started.
            </p>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Page
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {tree.map(node => (
              <PageTreeNode
                key={node.id}
                node={node}
                currentPageId={currentPageId}
                depth={0}
                onPageSelect={onPageSelect}
                workspaceSlug={workspaceSlug}
                spaceSlug={knowledgeSpace.slug}
              />
            ))}
          </div>
        )}
      </CardContent>
      
      <Separator />
      
      <div className="p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{publishedPages} published</span>
          <span>{draftPages} drafts</span>
        </div>
      </div>
    </Card>
  )
}
