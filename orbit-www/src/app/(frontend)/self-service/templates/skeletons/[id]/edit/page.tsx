import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser, getPayloadUserFromSession } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/access/workspace-access'
import { canManageTemplateDefinitions } from '@/lib/templates/authz'
import { getPayload } from 'payload'
import config from '@payload-config'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SkeletonEditorShell } from '@/components/features/template-authoring/SkeletonEditorShell'
import { getSkeleton, createSkeleton, saveSkeleton } from '../../skeleton-actions'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Skeleton editor (Template Authoring Phase 3, Task 3, plan §3.4).
 *
 * A Server Component. `getSkeleton` itself only requires active membership
 * (its own read gate), but the EDIT surface — an owner/admin-only action per
 * plan §2.1/§7.2 — additionally re-checks `canManageTemplateDefinitions`
 * here, mirroring `templates/[id]/edit/page.tsx`'s convention of gating the
 * editor page on manage, not just read. `notFound()` for a missing id OR an
 * unauthorized caller, never a redirect, so a skeleton's existence never
 * leaks to a plain member.
 */
export default async function EditSkeletonPage({ params }: PageProps) {
  const { id } = await params
  const skeleton = await getSkeleton(id)
  if (!skeleton) notFound()

  const payload = await getPayload({ config })
  const uid = (await getCurrentUser())?.id
  const isAdmin = isPlatformAdmin(await getPayloadUserFromSession())
  if (!(await canManageTemplateDefinitions(payload, uid, skeleton.workspaceId, isAdmin))) {
    notFound()
  }

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
            <h1 className="text-3xl font-bold">{skeleton.name}</h1>
            <p className="mt-2 text-muted-foreground">
              Edit this Orbit-hosted file bundle. Changes save as the new current state — there is no version
              history for skeletons.
            </p>
          </div>

          <SkeletonEditorShell
            mode="edit"
            workspaceId={skeleton.workspaceId}
            skeleton={skeleton}
            actions={{ createSkeleton, saveSkeleton }}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
