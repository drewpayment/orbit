import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { InstantiationProgress } from '@/components/features/templates/InstantiationProgress'

interface PageProps {
  params: Promise<{ workflowId: string }>
}

export default async function InstantiationProgressPage({ params }: PageProps) {
  const { workflowId } = await params

  // In a full implementation, we'd fetch the template name from the workflow
  // For now, we'll show a generic title
  const templateName = 'Template'

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container max-w-2xl">
            <div className="mb-6">
              <h1 className="text-2xl font-bold">Creating Repository</h1>
              <p className="text-muted-foreground mt-1">
                Workflow ID: {workflowId}
              </p>
            </div>

            <InstantiationProgress
              workflowId={workflowId}
              templateName={templateName}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
