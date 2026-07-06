import { Suspense } from 'react'
import Link from 'next/link'
import { Compass, Loader2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { CatalogListClient } from '@/components/features/catalog/CatalogListClient'
import { isEntityKind, type EntityKind } from '@/components/features/catalog/catalog-query'
import { searchCatalogEntities, getCatalogKindCounts } from './actions'

/**
 * Catalog landing (IDP refocus P1).
 *
 * Renders the unified catalog graph (`catalog-entities`) as a searchable,
 * kind-tabbed entity list scoped to the current user's workspaces. Replaces the
 * P0 static hub of navigation cards. Entity cards link to `/catalog/{id}` (the
 * detail surface). See docs/plans/2026-06-27-idp-refocus-implementation.md (P1).
 */

interface PageProps {
  searchParams: Promise<{
    q?: string
    kind?: string
    page?: string
    scope?: string
    workspace?: string
  }>
}

/** Best-effort workspace name from a page of results (populated at depth 1). */
function resolveWorkspaceName(
  docs: { workspace?: unknown }[],
  workspaceId: string,
): string {
  for (const doc of docs) {
    const ws = doc.workspace
    if (ws && typeof ws === 'object' && 'id' in ws && (ws as { id: string }).id === workspaceId) {
      return (ws as { name?: string }).name ?? 'this workspace'
    }
  }
  return 'this workspace'
}

async function CatalogContent({ searchParams }: PageProps) {
  const params = await searchParams
  const user = await getCurrentUser()

  const activeKind: EntityKind | 'all' = isEntityKind(params.kind) ? params.kind : 'all'
  const page = params.page ? Math.max(1, parseInt(params.page, 10) || 1) : 1
  const scope: 'all' | 'mine' = params.scope === 'mine' ? 'mine' : 'all'
  const workspaceId = params.workspace?.trim() || undefined

  const [result, counts] = await Promise.all([
    searchCatalogEntities({
      userId: user?.id,
      kind: activeKind === 'all' ? undefined : activeKind,
      query: params.q,
      page,
      scope,
      workspaceId,
    }),
    getCatalogKindCounts({ userId: user?.id, query: params.q, scope, workspaceId }),
  ])

  // Resolve the filtered workspace's display name from a returned doc's
  // populated (depth-1) workspace — no extra query. Falls back to a generic
  // label when the filter yields no rows (e.g. an empty workspace).
  const workspaceFilter = workspaceId
    ? { id: workspaceId, name: resolveWorkspaceName(result.docs, workspaceId) }
    : undefined

  return (
    <CatalogListClient
      entities={result.docs}
      totalPages={result.totalPages}
      currentPage={result.page}
      counts={counts}
      initialQuery={params.q}
      activeKind={activeKind}
      scope={scope}
      canCreate={result.canCreate}
      workspaceFilter={workspaceFilter}
    />
  )
}

export default function CatalogPage(props: PageProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Catalog</h1>
              <p className="mt-2 text-muted-foreground">
                Browse every service, API, topic and resource across your organization.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/catalog/types">
                <Compass className="h-4 w-4" />
                Entity types
              </Link>
            </Button>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <CatalogContent {...props} />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
