import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SkeletonEditorShell } from '@/components/features/template-authoring/SkeletonEditorShell'
import { getManageableTemplateWorkspaces } from '../../editor-actions'
import { createSkeleton, saveSkeleton } from '../skeleton-actions'

/**
 * New-skeleton flow (Template Authoring Phase 3, Task 3, plan §3.4). Resolves
 * the workspaces the caller may author skeletons in (owner/admin) to pick a
 * default `workspaceId` — `createSkeleton` re-checks the RBAC gate
 * server-side regardless, matching `templates/new/page.tsx`'s convention.
 */

interface PageProps {
  searchParams: Promise<{ workspace?: string }>
}

export default async function NewSkeletonPage({ searchParams }: PageProps) {
  const params = await searchParams
  const workspaces = await getManageableTemplateWorkspaces()
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
              href="/self-service/templates/skeletons"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Skeletons
            </Link>
            <h1 className="text-3xl font-bold">New skeleton</h1>
            <p className="mt-2 text-muted-foreground">
              Author a small, Orbit-hosted file bundle a template can fetch with the fetch:orbit-skeleton action.
            </p>
          </div>

          {!workspaceId ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <ShieldAlert className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">You don&rsquo;t have permission to create skeletons</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Authoring skeletons requires being an owner or admin of a workspace. Ask a workspace owner for
                access.
              </p>
            </div>
          ) : (
            <SkeletonEditorShell
              mode="create"
              workspaceId={workspaceId}
              skeleton={null}
              actions={{ createSkeleton, saveSkeleton }}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
