import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EntityForm } from '@/components/features/catalog/entity-form'
import { DeleteEntityButton } from '@/components/features/catalog/DeleteEntityButton'
import { getCatalogEntityDetail } from '../actions'
import { getEntityFormOptions } from '../../entity-actions'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Edit a catalog entity (Catalog Entity CRUD, WP2). Org-wide read resolves the
 * entity plus the caller's manage/delete rights and its provenance; a viewer
 * without manage rights is bounced back to the detail page (the RBAC gate is
 * re-enforced in updateCatalogEntity regardless). Projected entities render
 * their identity fields read-only inside EntityForm; only manual entities show
 * the Delete affordance (and only to owner/admins per canDelete).
 */
export default async function EditCatalogEntityPage({ params }: PageProps) {
  const { id } = await params

  const [data, options] = await Promise.all([getCatalogEntityDetail(id), getEntityFormOptions()])
  if (!data) {
    notFound()
  }
  if (!data.canManage) {
    redirect(`/catalog/${id}`)
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href={`/catalog/${id}`}
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to {data.entity.name}
            </Link>
            <h1 className="text-3xl font-bold">Edit entity</h1>
            <p className="mt-2 text-muted-foreground">
              Update this entity&rsquo;s details, ownership and links.
            </p>
          </div>

          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityForm mode="edit" options={options} entity={data.entity} />
            </CardContent>
          </Card>

          {data.canDelete && (
            <Card className="max-w-3xl border-destructive/40">
              <CardHeader>
                <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  Deleting removes this entity and every relation touching it. This cannot be
                  undone.
                </p>
                <DeleteEntityButton entityId={data.entity.id} entityName={data.entity.name} />
              </CardContent>
            </Card>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
