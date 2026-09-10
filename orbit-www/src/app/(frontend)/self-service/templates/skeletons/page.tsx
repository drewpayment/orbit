import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileStack, Loader2, Plus, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getManageableTemplateWorkspaces } from '../editor-actions'
import { listSkeletons, deleteSkeleton, type SkeletonListItem } from './skeleton-actions'
import { DeleteSkeletonButton } from '@/components/features/template-authoring/DeleteSkeletonButton'

/**
 * Skeleton list (Template Authoring Phase 3, Task 3, plan §3.4).
 *
 * A Server Component, mirroring the parent `/self-service/templates`
 * page's shape (Phase 2 Task 8): RBAC and every list resolve server-side.
 * Since skeletons are an authoring-only surface (consumed by
 * `fetch:orbit-skeleton` steps, never run directly), this page — unlike
 * the parent templates list's "Run" tab — is gated on the SAME owner/admin
 * "manageable workspaces" set as the "New template" CTA, not on plain
 * membership.
 */

interface PageProps {
  searchParams: Promise<{ workspace?: string }>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <FileStack className="mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function SkeletonCard({ item }: { item: SkeletonListItem }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{item.name}</CardTitle>
          <DeleteSkeletonButton id={item.id} name={item.name} onDelete={deleteSkeleton} />
        </div>
        <CardDescription className="line-clamp-2">{item.description || 'No description.'}</CardDescription>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>{item.fileCount} files</span>
          <span>&middot;</span>
          <span>{Math.round(item.totalSize / 1000).toLocaleString()} KB</span>
        </div>
      </CardHeader>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href={`/self-service/templates/skeletons/${item.id}/edit`}>Edit</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function WorkspaceLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}

async function SkeletonsList({ workspaceId }: { workspaceId: string }) {
  const items = await listSkeletons(workspaceId)
  if (items.length === 0) {
    return (
      <EmptyState
        title="No skeletons yet"
        body="A skeleton is a small, Orbit-hosted file bundle a template can fetch with the fetch:orbit-skeleton action — a way to create from scratch without a git repository."
      />
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <SkeletonCard key={item.id} item={item} />
      ))}
    </div>
  )
}

export default async function SkeletonsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const workspaces = await getManageableTemplateWorkspaces()
  const canAuthor = workspaces.length > 0
  const workspaceId =
    params.workspace && workspaces.some((w) => w.id === params.workspace) ? params.workspace : workspaces[0]?.id

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/self-service/templates"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Templates
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold">Skeletons</h1>
                <p className="mt-2 text-muted-foreground">
                  Orbit-hosted file bundles a template can fetch to create from scratch, without git.
                </p>
              </div>
              {canAuthor && workspaceId ? (
                <Button asChild size="sm">
                  <Link href={`/self-service/templates/skeletons/new?workspace=${workspaceId}`}>
                    <Plus className="h-4 w-4" />
                    New skeleton
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          {canAuthor && workspaces.length > 1 ? (
            <nav aria-label="Workspace" className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
              {workspaces.map((w) => (
                <WorkspaceLink
                  key={w.id}
                  href={`/self-service/templates/skeletons?workspace=${w.id}`}
                  active={w.id === workspaceId}
                >
                  {w.name}
                </WorkspaceLink>
              ))}
            </nav>
          ) : null}

          {!canAuthor || !workspaceId ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Authoring skeletons requires workspace admin access</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Skeletons feed directly into what a template produces, so only a workspace owner or admin may
                author them. Ask a workspace owner for access.
              </p>
            </div>
          ) : (
            <Suspense
              key={workspaceId}
              fallback={
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <SkeletonsList workspaceId={workspaceId} />
            </Suspense>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
