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

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  try {
    const app = await payload.findByID({
      collection: 'apps',
      id,
      depth: 2,
    })

    if (!app) notFound()

    // Fetch deployments for this app
    const { docs: deployments } = await payload.find({
      collection: 'deployments',
      where: {
        app: { equals: id },
      },
      sort: '-updatedAt',
      depth: 1,
    })

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
