import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { WorkspaceClient } from './workspace-client'
import { checkMembershipStatus } from './actions'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { WorkspaceKnowledgeSection } from '@/components/features/workspace/WorkspaceKnowledgeSection'
import { WorkspaceTemplatesSection } from '@/components/features/workspace/WorkspaceTemplatesSection'
import { RegistryQuotaWarning } from '@/components/features/workspace/RegistryQuotaWarning'

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

  // Fetch page counts for each space
  const knowledgeSpaces = await Promise.all(
    spacesResult.docs.map(async (space) => {
      const pagesResult = await payload.find({
        collection: 'knowledge-pages',
        where: {
          knowledgeSpace: {
            equals: space.id,
          },
        },
        limit: 1000,
      })

      const pages = pagesResult.docs
      return {
        id: space.id,
        name: space.name,
        slug: space.slug,
        description: space.description || undefined,
        icon: space.icon || undefined,
        visibility: space.visibility,
        pageCount: pages.length,
        publishedCount: pages.filter((p) => p.status === 'published').length,
        draftCount: pages.filter((p) => p.status === 'draft').length,
      }
    })
  )

  // Fetch templates for this workspace
  const templatesResult = await payload.find({
    collection: 'templates',
    where: {
      workspace: {
        equals: workspace.id,
      },
    },
    limit: 10,
    sort: '-usageCount',
  })

  const workspaceTemplates = templatesResult.docs.map((template) => ({
    id: template.id as string,
    name: template.name,
    slug: template.slug,
    description: template.description || undefined,
    language: template.language || undefined,
    framework: template.framework || undefined,
    visibility: template.visibility as 'workspace' | 'shared' | 'public',
    usageCount: template.usageCount || 0,
    categories: template.categories as string[] | undefined,
  }))

  // Check if user can manage knowledge spaces
  const canManageKnowledge = membershipStatus?.role
    ? ['owner', 'admin', 'contributor'].includes(membershipStatus.role)
    : false

  // Check if user can manage templates (owner/admin only)
  const canManageTemplates = membershipStatus?.role
    ? ['owner', 'admin'].includes(membershipStatus.role)
    : false

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
