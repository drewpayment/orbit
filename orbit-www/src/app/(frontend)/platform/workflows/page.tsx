import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ExternalLink, Workflow } from 'lucide-react'

export const metadata = {
  title: 'Workflows - Orbit Admin',
  description: 'Manage Temporal workflows and background operations',
}

const TEMPORAL_UI_URL = process.env.NEXT_PUBLIC_TEMPORAL_UI_URL || 'http://localhost:8080'

export default function WorkflowsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
            <p className="text-muted-foreground">
              Monitor and manage background workflows powered by Temporal.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Workflow className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">Temporal UI</CardTitle>
                </div>
                <CardDescription>
                  View workflow executions, search history, and debug running workflows
                  in the Temporal Web UI.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <a
                    href={TEMPORAL_UI_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Temporal UI
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
