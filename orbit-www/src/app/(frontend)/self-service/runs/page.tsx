import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, ScrollText } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { RunsTable } from '@/components/features/actions/RunsTable'
import { listRuns } from '../actions'

/**
 * Action Runs history (IDP refocus P3): the durable record of every Action
 * execution the user can see, newest first. Each row links to the run detail.
 */
async function RunsContent() {
  const user = await getCurrentUser()
  const runs = await listRuns(user?.id)

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <ScrollText className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">No runs yet</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Running a self-service action records a durable execution here — its status, inputs,
          outputs and logs. Run one from the catalog to get started.
        </p>
        <Link href="/self-service" className="mt-4 text-sm font-medium text-primary hover:underline">
          Browse actions
        </Link>
      </div>
    )
  }

  return <RunsTable runs={runs} />
}

export default function ActionRunsPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-4">
            <Link
              href="/self-service"
              className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Self-Service
            </Link>
            <h1 className="text-3xl font-bold">Action Runs</h1>
            <p className="mt-2 text-muted-foreground">
              Every self-service action execution, with status, inputs and logs.
            </p>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <RunsContent />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
