import { getPayload } from 'payload'
import config from '@payload-config'
import { getActor, memberWorkspaceIds } from '@/lib/authz'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { AppsCatalog } from '@/components/features/apps/AppsCatalog'

export default async function AppsPage() {
  // Phase 1: Parallelize initial setup
  const [payload, actor] = await Promise.all([getPayload({ config }), getActor()])

  if (!actor) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex-1 flex items-center justify-center">
            <Card>
              <CardHeader>
                <CardTitle>Sign in to view applications</CardTitle>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // Phase 2: Get user's workspace memberships
  const workspaceIds = await memberWorkspaceIds('member', actor)

  // Phase 3: Fetch apps for user's workspaces
  const { docs: apps } = await payload.find({
    collection: 'apps',
    where: {
      'workspace': {
        in: workspaceIds,
      },
    },
    depth: 2, // Include workspace and template relations
    sort: '-updatedAt',
  })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <AppsCatalog apps={apps} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
