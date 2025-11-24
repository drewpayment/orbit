import Link from 'next/link'
import type { Workspace, KnowledgeSpace, KnowledgePage } from '@/payload-types'

interface KnowledgeBreadcrumbsProps {
  workspace: Workspace
  space: KnowledgeSpace
  currentPage?: KnowledgePage | null
}

export function KnowledgeBreadcrumbs({
  workspace,
  space,
  currentPage,
}: KnowledgeBreadcrumbsProps) {
  return (
    <div className="sticky top-0 z-10 flex h-10 items-center border-b border-border bg-background px-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/workspaces/${workspace.slug}/knowledge`}
          className="hover:text-foreground transition-colors"
        >
          Knowledge Base
        </Link>
        <span>/</span>
        <Link
          href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}
          className="hover:text-foreground transition-colors"
        >
          {space.name}
        </Link>
        {currentPage && (
          <>
            <span>/</span>
            <span className="text-foreground">{currentPage.title}</span>
          </>
        )}
      </div>
    </div>
  )
}
