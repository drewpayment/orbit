import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, memberWorkspaceIds } from '@/lib/authz'
import { redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { ImportTemplateForm } from '@/components/features/templates/ImportTemplateForm'

export default async function ImportTemplatePage() {
  const actor = await getActor()

  if (!actor) {
    redirect('/login')
  }

  const payload = await getPayload({ config })

  // Get user's workspaces
  const workspaceIds = await memberWorkspaceIds('member', actor)
  const workspaces =
    workspaceIds.length === 0
      ? []
      : (
          await payload.find({
            collection: 'workspaces',
            where: { id: { in: workspaceIds } },
            limit: 100,
          })
        ).docs.map((w) => ({ id: String(w.id), name: w.name }))

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
