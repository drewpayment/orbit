import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { Building2, Users } from 'lucide-react'

export default async function WorkspacesPage() {
  // Phase 1: Parallelize initial setup
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  const session = await auth.api.getSession({ headers: reqHeaders })

  let userWorkspaces: Array<{
    id: string
    name: string
    slug: string
    description?: string | null
    avatar?: unknown
    memberCount: number
    userRole: string
  }> = []

  if (session?.user) {
    // Fetch workspaces where user is a member (using Better Auth user ID directly)
    const membershipsResult = await payload.find({
      collection: 'workspace-members',
      where: {
        user: { equals: session.user.id },
        status: { equals: 'active' },
      },
      limit: 100,
      overrideAccess: true,
    })

    // Phase 3: Get full workspace details with member counts in parallel
    // Also parallelize workspace + members fetch within each iteration
    userWorkspaces = await Promise.all(
      membershipsResult.docs.map(async (membership) => {
        const workspaceId = typeof membership.workspace === 'object' ? membership.workspace.id : membership.workspace

        // Fetch workspace and member count in parallel
        const [workspace, membersResult] = await Promise.all([
          payload.findByID({
            collection: 'workspaces',
            id: workspaceId,
          }),
          payload.find({
            collection: 'workspace-members',
            where: {
              workspace: { equals: workspaceId },
              status: { equals: 'active' },
            },
            limit: 0,
          }),
        ])

        return {
          ...workspace,
          memberCount: membersResult.totalDocs,
          userRole: membership.role,
        }
      })
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex-1 space-y-4 p-8 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">My Workspaces</h2>
              <p className="text-muted-foreground">
                Workspaces you belong to
              </p>
            </div>
            <Button asChild>
              <Link href="/admin/workspaces">
                <Building2 className="mr-2 h-4 w-4" />
                Manage Workspaces
              </Link>
            </Button>
          </div>

          {!session?.user ? (
            <Card>
              <CardHeader>
                <CardTitle>Sign in to view your workspaces</CardTitle>
                <CardDescription>
                  You need to be signed in to see your workspaces
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </CardContent>
            </Card>
          ) : userWorkspaces.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No workspaces yet</CardTitle>
                <CardDescription>
                  You haven&apos;t joined any workspaces yet
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href="/admin/workspaces">Browse Workspaces</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {userWorkspaces.map((workspace) => {
                const avatarUrl = workspace.avatar && typeof workspace.avatar === 'object' && 'url' in workspace.avatar 
                  ? String(workspace.avatar.url) 
                  : undefined
                
                return (
                  <Link key={workspace.id} href={`/workspaces/${workspace.slug}`}>
                    <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                      <CardHeader>
                        <div className="flex items-start gap-4">
                          {avatarUrl && (
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={avatarUrl} alt={workspace.name} />
                              <AvatarFallback>{workspace.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-xl">{workspace.name}</CardTitle>
                              <Badge variant="outline" className="text-xs">
                                {workspace.userRole}
                              </Badge>
                            </div>
                            <CardDescription className="mt-1">
                              /{workspace.slug}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {workspace.description && (
                          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                            {workspace.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>{workspace.memberCount} members</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
