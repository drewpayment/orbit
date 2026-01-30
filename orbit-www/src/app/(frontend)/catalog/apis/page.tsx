import { Suspense } from 'react'
import { searchAPIs, getAllWorkspaces, getAllTags } from './actions'
import { APICatalogClient } from './catalog-client'
import { Loader2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/session'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'

interface PageProps {
  searchParams: Promise<{
    q?: string
    status?: string
    workspace?: string
    tags?: string
    page?: string
  }>
}

async function APICatalogContent({ searchParams }: PageProps) {
  const params = await searchParams
  const user = await getCurrentUser()

  const [apisResult, workspaces, tags] = await Promise.all([
    searchAPIs({
      query: params.q,
      status: params.status as 'draft' | 'published' | 'deprecated' | undefined,
      workspaceId: params.workspace,
      tags: params.tags?.split(',').filter(Boolean),
      userId: user?.id,
      page: params.page ? parseInt(params.page) : 1,
    }),
    getAllWorkspaces(),
    getAllTags(),
  ])

  return (
    <APICatalogClient
      initialApis={apisResult.docs}
      totalPages={apisResult.totalPages}
      currentPage={apisResult.page || 1}
      workspaces={workspaces}
      allTags={tags}
      initialQuery={params.q}
      initialStatus={params.status}
      initialWorkspace={params.workspace}
      initialTags={params.tags?.split(',').filter(Boolean)}
    />
  )
}

export default async function APICatalogPage(props: PageProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">API Catalog</h1>
            <p className="text-muted-foreground mt-2">
              Discover and explore APIs across your organization
            </p>
          </div>

          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <APICatalogContent {...props} />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
