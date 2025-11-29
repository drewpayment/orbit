import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { WorkflowProgress } from '@/components/features/templates/WorkflowProgress'

interface PageProps {
  params: Promise<{ workflowId: string }>
  searchParams: Promise<{ templateId?: string; workspaceId?: string; githubOrg?: string }>
}

export default async function WorkflowProgressPage({ params, searchParams }: PageProps) {
  const { workflowId } = await params
  const { templateId, workspaceId, githubOrg } = await searchParams

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/login')
  }

  // TODO: Fetch template name from workflow metadata
  // For now, using a placeholder
  const templateName = 'Template'

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 p-8">
          <div className="max-w-2xl mx-auto">
            <WorkflowProgress
              workflowId={workflowId}
              templateName={templateName}
              templateId={templateId}
              workspaceId={workspaceId}
              installationId={githubOrg}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
