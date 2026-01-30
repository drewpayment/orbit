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
  WorkspaceAPIsCard,
  WorkspaceRegistriesCard,
  WorkspaceRecentDocsCard,
  WorkspaceQuickLinksCard,
  WorkspaceMembersCardSimple,
  WorkspaceKafkaOverviewCard,
} from '@/components/features/workspace'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function WorkspacePage({ params }: PageProps) {
  const { slug } = await params

  // Phase 1: Parallelize initial setup (payload, session, headers all independent)
  const [payload, reqHeaders] = await Promise.all([
    getPayload({ config }),
    headers(),
  ])

  // Get session (needs headers)
  const session = await auth.api.getSession({ headers: reqHeaders })

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

  // Phase 2: Parallelize all workspace-dependent fetches
  // These are all independent once we have workspace.id
  const [
    membersResult,
    membershipStatus,
    spacesResult,
    appsResult,
    apisResult,
    registryImagesResult,
    virtualClusterCountResult,
    topicCountResult,
    pendingShareCountResult,
  ] = await Promise.all([
    // Fetch members
    payload.find({
      collection: 'workspace-members',
      where: {
        workspace: { equals: workspace.id },
        status: { equals: 'active' },
      },
      limit: 100,
    }),
    // Check membership status for current user
    session?.user
      ? checkMembershipStatus(workspace.id, session.user.id)
      : Promise.resolve(undefined),
    // Fetch knowledge spaces
    payload.find({
      collection: 'knowledge-spaces',
      where: { workspace: { equals: workspace.id } },
      limit: 100,
      sort: 'name',
    }),
    // Fetch apps
    payload.find({
      collection: 'apps',
      where: { workspace: { equals: workspace.id } },
      sort: '-latestBuild.builtAt',
      limit: 10,
      depth: 1,
    }),
    // Fetch API schemas
    payload.find({
      collection: 'api-schemas',
      where: { workspace: { equals: workspace.id } },
      sort: '-updatedAt',
      limit: 10,
      depth: 0,
    }),
    // Fetch registry images (overrideAccess needed since server component has no user session)
    payload.find({
      collection: 'registry-images',
      where: { workspace: { equals: workspace.id } },
      sort: '-pushedAt',
      limit: 10,
      depth: 2,
      overrideAccess: true,
    }),
    // Fetch virtual cluster count
    payload.count({
      collection: 'kafka-virtual-clusters',
      where: { workspace: { equals: workspace.id } },
      overrideAccess: true,
    }),
    // Fetch topic count
    payload.count({
      collection: 'kafka-topics',
      where: { workspace: { equals: workspace.id } },
      overrideAccess: true,
    }),
    // Fetch pending share request count (incoming requests to this workspace)
    payload.count({
      collection: 'kafka-topic-shares',
      where: {
        targetWorkspace: { equals: workspace.id },
        status: { equals: 'pending' },
      },
      overrideAccess: true,
    }),
  ])

  const members = membersResult.docs

  // Extract members for simplified display
  const memberUsers = members
    .map((m) => {
      const user = typeof m.user === 'object' ? m.user : null
      if (!user) return null
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar && typeof user.avatar === 'object' ? user.avatar : null,
      }
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)

  // Extract parent and child workspaces
  const parentWorkspace = workspace.parentWorkspace && typeof workspace.parentWorkspace === 'object'
    ? workspace.parentWorkspace
    : null

  const childWorkspaces = workspace.childWorkspaces && Array.isArray(workspace.childWorkspaces)
    ? workspace.childWorkspaces.filter(w => typeof w === 'object')
    : []

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

  // Extract Kafka counts for the overview card
  const virtualClusterCount = virtualClusterCountResult.totalDocs
  const topicCount = topicCountResult.totalDocs
  const pendingShareCount = pendingShareCountResult.totalDocs

  // Phase 3: Fetch recent pages (depends on spacesResult)
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
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-6">
                  {workspace.avatar && typeof workspace.avatar === 'object' && 'url' in workspace.avatar && workspace.avatar.url && (
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={workspace.avatar.url} alt={workspace.name} />
                      <AvatarFallback>{workspace.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                  <div>
                    <h1 className="text-4xl font-bold text-foreground">
                      {workspace.name}
                    </h1>
                    <p className="text-lg text-muted-foreground">
                      /{workspace.slug}
                    </p>
                    {workspace.description && (
                      <p className="text-muted-foreground mt-2 max-w-2xl">{workspace.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {membershipStatus?.role && (
                    <Badge variant="secondary">{membershipStatus.role}</Badge>
                  )}
                  <WorkspaceClient workspaceId={workspace.id} membershipStatus={membershipStatus} />
                </div>
              </div>
            </div>

            {/* Registry Quota Warning */}
            <div className="mb-8">
              <RegistryQuotaWarning workspaceId={workspace.id} />
            </div>

            {/* 3-Column Dashboard Layout */}
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr_280px]">
              {/* Left Column - Applications + APIs */}
              <div className="space-y-6">
                <WorkspaceApplicationsCard apps={appsResult.docs} />
                <WorkspaceAPIsCard apis={apisResult.docs} workspaceSlug={workspace.slug} />
              </div>

              {/* Middle Column - Kafka Overview + Registries + Recent Docs */}
              <div className="space-y-6">
                <WorkspaceKafkaOverviewCard
                  workspaceSlug={workspace.slug}
                  virtualClusterCount={virtualClusterCount}
                  topicCount={topicCount}
                  pendingShareCount={pendingShareCount}
                />
                <WorkspaceRegistriesCard
                  images={registryImages}
                  workspaceSlug={workspace.slug}
                />
                <WorkspaceRecentDocsCard
                  docs={recentDocs}
                  workspaceSlug={workspace.slug}
                />
              </div>

              {/* Right Column - Sidebar Cards */}
              <div className="space-y-6">
                {/* Hierarchy Card */}
                {(parentWorkspace || childWorkspaces.length > 0) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Workspace Hierarchy</CardTitle>
                      <CardDescription>Related workspaces</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {parentWorkspace && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                              Parent Workspace
                            </p>
                            <Link
                              href={`/workspaces/${parentWorkspace.slug}`}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                            >
                              <Avatar className="h-8 w-8">
                                {parentWorkspace.avatar && typeof parentWorkspace.avatar === 'object' && 'url' in parentWorkspace.avatar && parentWorkspace.avatar.url && (
                                  <AvatarImage src={parentWorkspace.avatar.url} alt={parentWorkspace.name} />
                                )}
                                <AvatarFallback>
                                  {parentWorkspace.name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {parentWorkspace.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  /{parentWorkspace.slug}
                                </p>
                              </div>
                            </Link>
                          </div>
                        )}

                        {childWorkspaces.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                              Child Workspaces ({childWorkspaces.length})
                            </p>
                            <div className="space-y-1">
                              {childWorkspaces.map((child) => (
                                <Link
                                  key={child.id}
                                  href={`/workspaces/${child.slug}`}
                                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                                >
                                  <Avatar className="h-8 w-8">
                                    {child.avatar && typeof child.avatar === 'object' && 'url' in child.avatar && child.avatar.url && (
                                      <AvatarImage src={child.avatar.url} alt={child.name} />
                                    )}
                                    <AvatarFallback>
                                      {child.name.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {child.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
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
                <WorkspaceMembersCardSimple
                  members={memberUsers}
                  totalCount={members.length}
                />

                {/* Quick Links Card */}
                <WorkspaceQuickLinksCard workspaceSlug={workspace.slug} />
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
