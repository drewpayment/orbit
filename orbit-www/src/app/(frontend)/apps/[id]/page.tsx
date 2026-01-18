import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { AppDetail } from '@/components/features/apps/AppDetail'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

interface AppDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AppDetailPage({ params }: AppDetailPageProps) {
  const { id } = await params

  // Phase 1: Parallelize initial setup
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user) {
    redirect('/login')
  }

  try {
    // Phase 2: Fetch app and deployments in parallel (both use id directly)
    const [app, { docs: deployments }] = await Promise.all([
      payload.findByID({
        collection: 'apps',
        id,
        depth: 2,
      }),
      payload.find({
        collection: 'deployments',
        where: { app: { equals: id } },
        sort: '-updatedAt',
        depth: 1,
      }),
    ])

    if (!app) notFound()

    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <AppDetail app={app} deployments={deployments} />
        </SidebarInset>
      </SidebarProvider>
    )
  } catch {
    notFound()
  }
}
