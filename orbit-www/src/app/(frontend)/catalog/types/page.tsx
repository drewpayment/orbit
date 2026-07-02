import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Compass, Loader2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { EntityTypeCard } from '@/components/features/catalog/EntityTypeCard'
import { getEntityTypesHome } from './actions'

/**
 * Types home (Entity Scores & Golden Paths, docs/plans/2026-07-01-entity-scores-and-golden-paths.md).
 *
 * Lists every catalog `kind` (service, api, resource, …) as a card carrying
 * its definition: display name, inherited base value, scoring weight, and a
 * golden-path summary — resolved via `listEntityTypes` so kinds with no
 * customized row still render their built-in defaults ("nothing is
 * unscored"). Cards link to `/catalog/types/{kind}` for the view/edit page.
 * Linked from the catalog landing page header.
 */

async function TypesContent() {
  const user = await getCurrentUser()
  const home = await getEntityTypesHome(user?.id)

  if (!home.workspaceId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Compass className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">No workspace access</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Join a workspace to see how its catalog kinds are defined.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {home.items.map((item) => (
        <EntityTypeCard key={item.kind} item={item} />
      ))}
    </div>
  )
}

export default function EntityTypesPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div>
            <Link
              href="/catalog"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Catalog
            </Link>
            <div className="mb-8">
              <h1 className="text-3xl font-bold">Entity types</h1>
              <p className="mt-2 text-muted-foreground">
                What each catalog kind means here, its golden path, and the score an entity
                inherits before any scorecard applies.
              </p>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <TypesContent />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
