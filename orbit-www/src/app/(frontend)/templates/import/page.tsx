import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { ImportTemplateForm } from '@/components/features/templates/ImportTemplateForm'

export default async function ImportTemplatePage() {
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
          <ImportTemplateForm workspaces={workspaces} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
