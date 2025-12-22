import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { WorkspaceClient } from './workspace-client'
import { checkMembershipStatus } from './actions'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { RegistryQuotaWarning } from '@/components/features/workspace/RegistryQuotaWarning'
import {
  WorkspaceApplicationsCard,
  WorkspaceRegistriesCard,
  WorkspaceRecentDocsCard,
  WorkspaceQuickLinksCard,
  WorkspaceMembersCardSimple,
} from '@/components/features/workspace'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function WorkspacePage({ params }: PageProps) {
  const { slug } = await params
  const payload = await getPayload({ config })

  // Get current user session
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Fetch workspace with relationships
  const workspaceResult = await payload.find({
    collection: 'workspaces',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
    depth: 2, // Fetch related workspaces
  })

  if (!workspaceResult.docs.length) {
    notFound()
  }

  const workspace = workspaceResult.docs[0]

  // Fetch members
  const membersResult = await payload.find({
    collection: 'workspace-members',
    where: {
      workspace: {
        equals: workspace.id,
      },
      status: {
        equals: 'active',
      },
    },
    limit: 100,
  })

  const members = membersResult.docs

  // Check membership status for current user
  let membershipStatus
  if (session?.user) {
    membershipStatus = await checkMembershipStatus(workspace.id, session.user.id)
  }

  const ownerMembers = members.filter(m => m.role === 'owner')
  const adminMembers = members.filter(m => m.role === 'admin')
  const regularMembers = members.filter(m => m.role === 'member')

  // Extract parent and child workspaces
  const parentWorkspace = workspace.parentWorkspace && typeof workspace.parentWorkspace === 'object' 
    ? workspace.parentWorkspace 
    : null
  
  const childWorkspaces = workspace.childWorkspaces && Array.isArray(workspace.childWorkspaces)
    ? workspace.childWorkspaces.filter(w => typeof w === 'object')
    : []

  // Fetch knowledge spaces for this workspace
  const spacesResult = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    limit: 100,
    sort: 'name',
  })

  // Fetch apps for this workspace
  const appsResult = await payload.find({
    collection: 'apps',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    sort: '-latestBuild.builtAt',
    limit: 10,
    depth: 1,
  })

  // Fetch registry images for this workspace
  const registryImagesResult = await payload.find({
    collection: 'registry-images',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    sort: '-pushedAt',
    limit: 10,
    depth: 2,
  })

  // Transform registry images for display
  const registryImages = registryImagesResult.docs.map((img) => {
    const app = typeof img.app === 'object' ? img.app : null
    const registryConfig = app && typeof app.registryConfig === 'object' ? app.registryConfig : null
    const registryType = (registryConfig?.type || 'orbit') as 'orbit' | 'ghcr' | 'acr'
    const registryName = registryConfig?.name || 'Orbit Registry'

    let imageUrl = ''
    if (registryType === 'ghcr' && registryConfig?.ghcrOwner) {
      imageUrl = `https://ghcr.io/${registryConfig.ghcrOwner}/${app?.name || 'unknown'}:${img.tag}`
    } else if (registryType === 'acr' && registryConfig?.acrLoginServer) {
      imageUrl = `https://${registryConfig.acrLoginServer}/${app?.name || 'unknown'}:${img.tag}`
    } else {
      imageUrl = `localhost:5050/${app?.name || 'unknown'}:${img.tag}`
    }

    return {
      registryType,
      registryName,
      imageUrl,
      appName: app?.name || 'Unknown App',
      appId: app?.id || '',
    }
  })

  // Fetch recent knowledge pages across all spaces in this workspace
  const spaceIds = spacesResult.docs.map((s) => s.id)
  const recentPagesResult = spaceIds.length > 0
    ? await payload.find({
        collection: 'knowledge-pages',
        where: {
          knowledgeSpace: {
            in: spaceIds,
          },
        },
        sort: '-updatedAt',
        limit: 10,
        depth: 1,
      })
    : { docs: [] }

  const recentDocs = recentPagesResult.docs.map((page) => {
    const space = typeof page.knowledgeSpace === 'object' ? page.knowledgeSpace : null
    return {
      id: page.id,
      title: page.title,
      spaceSlug: space?.slug || '',
      pageSlug: page.slug,
    }
  })


  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
                {/* Workspace Header */}
                <div className="mb-8">
                  <div className="flex items-start gap-6">
                    {workspace.avatar && typeof workspace.avatar === 'object' && 'url' in workspace.avatar && workspace.avatar.url && (
                      <Avatar className="h-24 w-24">
                        <AvatarImage src={workspace.avatar.url} alt={workspace.name} />
                        <AvatarFallback>{workspace.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                          {workspace.name}
                        </h1>
                      </div>
                      <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">
                        /{workspace.slug}
                      </p>
                      {workspace.description && (
                        <p className="text-gray-700 dark:text-gray-300">{workspace.description}</p>
                      )}
                    </div>
                    <WorkspaceClient workspaceId={workspace.id} membershipStatus={membershipStatus} />
                  </div>
                </div>

                <Separator className="mb-8" />

                {/* Registry Quota Warning */}
                <div className="mb-8">
                  <RegistryQuotaWarning workspaceId={workspace.id} />
                </div>

                {/* Workspace Content */}
                <div className="grid gap-8 lg:grid-cols-3">
                  <div className="lg:col-span-2 space-y-8">
                    <Card>
                      <CardHeader>
                        <CardTitle>Welcome</CardTitle>
                        <CardDescription>
                          This workspace is part of the Orbit Internal Developer Portal
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-gray-700 dark:text-gray-300">
                          This is the default landing page for the <strong>{workspace.name}</strong> workspace.
                          Workspace members can customize this page with wikis, documentation, and other
                          content to help their team collaborate effectively.
                        </p>
                      </CardContent>
                    </Card>

                    {/* Knowledge Section */}
                    <WorkspaceKnowledgeSection
                      workspaceSlug={workspace.slug}
                      spaces={knowledgeSpaces}
                      canManage={canManageKnowledge}
                    />

                    {/* Templates Section */}
                    <WorkspaceTemplatesSection
                      workspaceSlug={workspace.slug}
                      workspaceId={workspace.id}
                      templates={workspaceTemplates}
                      canManage={canManageTemplates}
                    />
                  </div>

                  <div className="space-y-8">
                    {/* Hierarchy Card */}
                    {(parentWorkspace || childWorkspaces.length > 0) && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Workspace Hierarchy</CardTitle>
                          <CardDescription>
                            Related workspaces
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {parentWorkspace && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                                  Parent Workspace
                                </p>
                                <Link
                                  href={`/workspaces/${parentWorkspace.slug}`}
                                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                >
                                  {parentWorkspace.avatar && typeof parentWorkspace.avatar === 'object' && 'url' in parentWorkspace.avatar && parentWorkspace.avatar.url && (
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage src={parentWorkspace.avatar.url} alt={parentWorkspace.name} />
                                      <AvatarFallback>
                                        {parentWorkspace.name.slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}
                                  {(!parentWorkspace.avatar || typeof parentWorkspace.avatar !== 'object') && (
                                    <Avatar className="h-8 w-8">
                                      <AvatarFallback>
                                        {parentWorkspace.name.slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {parentWorkspace.name}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      /{parentWorkspace.slug}
                                    </p>
                                  </div>
                                </Link>
                              </div>
                            )}

                            {childWorkspaces.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                                  Child Workspaces ({childWorkspaces.length})
                                </p>
                                <div className="space-y-1">
                                  {childWorkspaces.map((child) => (
                                    <Link
                                      key={child.id}
                                      href={`/workspaces/${child.slug}`}
                                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    >
                                      {child.avatar && typeof child.avatar === 'object' && 'url' in child.avatar && child.avatar.url && (
                                        <Avatar className="h-8 w-8">
                                          <AvatarImage src={child.avatar.url} alt={child.name} />
                                          <AvatarFallback>
                                            {child.name.slice(0, 2).toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                      )}
                                      {(!child.avatar || typeof child.avatar !== 'object') && (
                                        <Avatar className="h-8 w-8">
                                          <AvatarFallback>
                                            {child.name.slice(0, 2).toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                          {child.name}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                          /{child.slug}
                                        </p>
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Members Card */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Members ({members.length})</CardTitle>
                        <CardDescription>
                          People in this workspace
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {ownerMembers.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                                Owners
                              </p>
                              <div className="space-y-2">
                                {ownerMembers.map((member) => {
                                  const user = typeof member.user === 'object' ? member.user : null
                                  if (!user) return null
                                  return (
                                    <div key={member.id} className="flex items-center gap-3">
                                      <Avatar className="h-8 w-8">
                                        {user.avatar && typeof user.avatar === 'object' && 'url' in user.avatar && user.avatar.url && (
                                          <AvatarImage src={user.avatar.url} />
                                        )}
                                        <AvatarFallback>
                                          {(user.name || user.email)?.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                          {user.name || user.email}
                                        </p>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {adminMembers.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                                Admins
                              </p>
                              <div className="space-y-2">
                                {adminMembers.map((member) => {
                                  const user = typeof member.user === 'object' ? member.user : null
                                  if (!user) return null
                                  return (
                                    <div key={member.id} className="flex items-center gap-3">
                                      <Avatar className="h-8 w-8">
                                        {user.avatar && typeof user.avatar === 'object' && 'url' in user.avatar && user.avatar.url && (
                                          <AvatarImage src={user.avatar.url} />
                                        )}
                                        <AvatarFallback>
                                          {(user.name || user.email)?.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                          {user.name || user.email}
                                        </p>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {regularMembers.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                                Members
                              </p>
                              <div className="space-y-2">
                                {regularMembers.slice(0, 5).map((member) => {
                                  const user = typeof member.user === 'object' ? member.user : null
                                  if (!user) return null
                                  return (
                                    <div key={member.id} className="flex items-center gap-3">
                                      <Avatar className="h-8 w-8">
                                        {user.avatar && typeof user.avatar === 'object' && 'url' in user.avatar && user.avatar.url && (
                                          <AvatarImage src={user.avatar.url} />
                                        )}
                                        <AvatarFallback>
                                          {(user.name || user.email)?.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                          {user.name || user.email}
                                        </p>
                                      </div>
                                    </div>
                                  )
                                })}
                                {regularMembers.length > 5 && (
                                  <p className="text-sm text-gray-500 dark:text-gray-400">
                                    +{regularMembers.length - 5} more
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </div>
          </SidebarInset>
      </SidebarProvider>
  )
}
