import Link from 'next/link'
import type { Workspace, KnowledgeSpace, KnowledgePage } from '@/payload-types'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

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
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/workspaces/${workspace.slug}/knowledge`}>
                Knowledge Base
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {currentPage ? (
              <BreadcrumbLink asChild>
                <Link href={`/workspaces/${workspace.slug}/knowledge/${space.slug}`}>
                  {space.name}
                </Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{space.name}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {currentPage && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{currentPage.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
