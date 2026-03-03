import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { LaunchesTable } from '@/components/features/launches/LaunchesTable'

export default async function LaunchesPage() {
  // Phase 1: Parallelize initial setup
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  if (!session?.user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex-1 flex items-center justify-center">
            <Card>
              <CardHeader>
                <CardTitle>Sign in to view launches</CardTitle>
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
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: session.user.id },
      status: { equals: 'active' },
    },
    limit: 1000,
  })

  const workspaceIds = memberships.docs.map(m =>
    String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
  )

  // Phase 3: Fetch launches for user's workspaces
  const { docs: launches } = workspaceIds.length > 0
    ? await payload.find({
        collection: 'launches',
        where: {
          workspace: { in: workspaceIds },
        },
        depth: 2,
        sort: '-updatedAt',
        limit: 100,
      })
    : { docs: [] }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <LaunchesTable launches={launches as any} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
