import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EntityForm } from '@/components/features/catalog/entity-form'
import { ENTITY_KINDS, type EntityKind } from '@/collections/catalog/constants'
import { getEntityFormOptions } from '../entity-actions'

interface NewEntityPageProps {
  searchParams: Promise<{ workspace?: string; kind?: string }>
}

/**
 * Create a manual catalog entity (Catalog Entity CRUD, WP2). Resolves the
 * caller's authoring options (workspaces they can create in + platform-admin
 * global capability) as a defense-in-depth gate on top of the RBAC-enforced
 * createCatalogEntity action. When the caller can create nowhere, a friendly
 * gate replaces the form.
 */
export default async function NewCatalogEntityPage({ searchParams }: NewEntityPageProps) {
  const params = await searchParams
  const options = await getEntityFormOptions()
  const canCreate = options.workspaces.length > 0 || options.canCreateGlobal

  // Deep-link prefill (WP3 workspace landpage "New entity" / "Create team"):
  // only honour a workspace the caller can actually author in; ignore otherwise
  // so the form falls back to a free choice rather than locking to a forbidden
  // workspace the server would reject anyway.
  const fixedWorkspaceId = options.workspaces.some((w) => w.id === params.workspace)
    ? params.workspace
    : undefined
  const defaultKind = (ENTITY_KINDS as readonly string[]).includes(params.kind ?? '')
    ? (params.kind as EntityKind)
    : undefined

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/catalog"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Catalog
            </Link>
            <h1 className="text-3xl font-bold">New entity</h1>
            <p className="mt-2 text-muted-foreground">
              Register a service, API, team, datastore or any other entity by hand. It appears in
              the catalog immediately and can be related to other entities.
            </p>
          </div>

          {canCreate ? (
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <EntityForm
                  mode="create"
                  options={options}
                  fixedWorkspaceId={fixedWorkspaceId}
                  defaultKind={defaultKind}
                  lockKind={defaultKind !== undefined}
                />
              </CardContent>
            </Card>
          ) : (
            <NotPermitted />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function NotPermitted() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="text-lg font-semibold">You can&rsquo;t create entities yet</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Creating a catalog entity requires membership in a workspace. Ask a workspace owner to add
        you, then come back to register your services.
      </p>
    </div>
  )
}
