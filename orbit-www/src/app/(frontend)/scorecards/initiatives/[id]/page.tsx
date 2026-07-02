import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { InitiativeHeader } from '@/components/features/scorecards/initiatives/InitiativeHeader'
import { ActionItemsTable } from '@/components/features/scorecards/initiatives/ActionItemsTable'
import { getInitiativeDetail } from '../actions'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Initiative detail: the header (status, deadline, owner, scorecard link,
 * progress) with gated lifecycle controls, plus the action-items table where
 * members work their items. Tenancy + RBAC are enforced in getInitiativeDetail
 * (which also computes `canManage`); an out-of-scope or missing id 404s.
 */
export default async function InitiativeDetailPage({ params }: PageProps) {
  const { id } = await params
  const detail = await getInitiativeDetail(id)
  if (!detail) notFound()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-6 p-8 pt-6">
          <div>
            <Link
              href="/scorecards/initiatives"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Initiatives
            </Link>
            <InitiativeHeader initiative={detail} canManage={detail.canManage} />
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Action items ({detail.items.length})</h2>
            <ActionItemsTable items={detail.items} />
          </section>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
