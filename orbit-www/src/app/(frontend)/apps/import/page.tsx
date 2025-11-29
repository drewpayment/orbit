import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { ImportAppForm } from '@/components/features/apps/ImportAppForm'

export default async function ImportAppPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Get user's workspaces
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: session.user.id },
      status: { equals: 'active' },
    },
    depth: 1,
    limit: 100,
  })

  const workspaces = memberships.docs
    .map((m) => {
      const ws = typeof m.workspace === 'object' ? m.workspace : null
      if (!ws) return null
      return { id: String(ws.id), name: ws.name }
    })
    .filter((ws): ws is { id: string; name: string } => ws !== null)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          <div className="container mx-auto max-w-2xl">
            <h1 className="text-3xl font-bold mb-2">Import Repository</h1>
            <p className="text-muted-foreground mb-8">
              Add an existing repository to your application catalog.
            </p>
            <ImportAppForm workspaces={workspaces} />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
