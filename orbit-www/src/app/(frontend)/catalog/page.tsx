import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
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
  }>
}

async function CatalogContent({ searchParams }: PageProps) {
  const params = await searchParams
  const user = await getCurrentUser()

  const activeKind: EntityKind | 'all' = isEntityKind(params.kind) ? params.kind : 'all'
  const page = params.page ? Math.max(1, parseInt(params.page, 10) || 1) : 1

  const [result, counts] = await Promise.all([
    searchCatalogEntities({
      userId: user?.id,
      kind: activeKind === 'all' ? undefined : activeKind,
      query: params.q,
      page,
    }),
    getCatalogKindCounts({ userId: user?.id, query: params.q }),
  ])

  return (
    <CatalogListClient
      entities={result.docs}
      totalPages={result.totalPages}
      currentPage={result.page}
      counts={counts}
      initialQuery={params.q}
      activeKind={activeKind}
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
          <div className="mb-8">
            <h1 className="text-3xl font-bold">Catalog</h1>
            <p className="mt-2 text-muted-foreground">
              Browse every service, API, topic and resource across your organization.
            </p>
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
