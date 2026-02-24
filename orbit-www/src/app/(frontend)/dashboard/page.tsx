import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Plus, LayoutTemplate } from 'lucide-react'
import { getPayloadClient, getSession, getUserWorkspaceMemberships } from '@/lib/data/cached-queries'
import {
  DashboardGreeting,
  DashboardStatsRow,
  DashboardWorkspacesCard,
  DashboardAppHealthCard,
  DashboardActivityFeed,
  DashboardQuickActions,
} from '@/components/features/dashboard'
import type { Activity } from '@/components/features/dashboard'

export default async function DashboardPage() {
  // Phase 1: Get payload client + user session
  const [payload, session] = await Promise.all([
    getPayloadClient(),
    getSession(),
  ])

  // Phase 2: Get user's workspace memberships
  const memberships = session?.user
    ? await getUserWorkspaceMemberships(session.user.id)
    : []

  const workspaceIds = memberships
    .map((m) => (typeof m.workspace === 'object' ? m.workspace?.id : m.workspace))
    .filter((id): id is string => !!id)

  // Phase 3: Parallel aggregate queries across user's workspaces
  const hasWorkspaces = workspaceIds.length > 0
  const workspaceFilter = { workspace: { in: workspaceIds } }

  const [
    appsResult,
    kafkaTopicCount,
    virtualClusterCount,
    apiSchemaCount,
    publishedApiCount,
    recentTopics,
    recentSchemas,
    knowledgeSpacesResult,
  ] = hasWorkspaces
    ? await Promise.all([
        // Apps with status (used for stats + health card + activity)
        payload.find({
          collection: 'apps',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 10,
          depth: 1,
        }),
        // Kafka topic count (overrideAccess: server component has no user session for Kafka ACLs)
        payload.count({
          collection: 'kafka-topics',
          where: workspaceFilter,
          overrideAccess: true,
        }),
        // Virtual cluster count (overrideAccess: server component has no user session for Kafka ACLs)
        payload.count({
          collection: 'kafka-virtual-clusters',
          where: workspaceFilter,
          overrideAccess: true,
        }),
        // API schema count
        payload.count({
          collection: 'api-schemas',
          where: workspaceFilter,
        }),
        // Published API schema count
        payload.count({
          collection: 'api-schemas',
          where: { ...workspaceFilter, status: { equals: 'published' } },
        }),
        // Recent Kafka topics (for activity; overrideAccess: server component has no user session for Kafka ACLs)
        payload.find({
          collection: 'kafka-topics',
          where: workspaceFilter,
          sort: '-createdAt',
          limit: 3,
          depth: 1,
          overrideAccess: true,
        }),
        // Recent API schemas (for activity)
        payload.find({
          collection: 'api-schemas',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 3,
          depth: 1,
        }),
        // Knowledge spaces (to get space IDs for recent docs)
        payload.find({
          collection: 'knowledge-spaces',
          where: workspaceFilter,
          limit: 100,
        }),
      ])
    : [
        { docs: [], totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { docs: [] },
        { docs: [] },
        { docs: [] },
      ]

  // Phase 4: Recent docs (depends on knowledge spaces)
  const spaceIds = Array.isArray(knowledgeSpacesResult)
    ? []
    : 'docs' in knowledgeSpacesResult
      ? knowledgeSpacesResult.docs.map((s) => s.id)
      : []

  const recentDocs = spaceIds.length > 0
    ? await payload.find({
        collection: 'knowledge-pages',
        where: { knowledgeSpace: { in: spaceIds } },
        sort: '-updatedAt',
        limit: 3,
        depth: 1,
      })
    : { docs: [] }

  // Compute stats
  const apps = 'docs' in appsResult ? appsResult.docs : []
  const appCount = 'totalDocs' in appsResult ? appsResult.totalDocs : 0
  const healthyCount = apps.filter((a) => a.status === 'healthy').length
  const degradedCount = apps.filter((a) => a.status === 'degraded' || a.status === 'down').length

  // Build activity feed from recent items
  const activities: Activity[] = []

  // App activities
  for (const app of apps.slice(0, 3)) {
    activities.push({
      type: 'app',
      title: app.status === 'healthy' ? 'App deployed' : 'App status changed',
      description: `${app.name} in ${typeof app.workspace === 'object' ? app.workspace?.name : 'workspace'}`,
      timestamp: app.updatedAt,
    })
  }

  // Kafka topic activities
  const topics = 'docs' in recentTopics ? recentTopics.docs : []
  for (const topic of topics) {
    activities.push({
      type: 'topic',
      title: 'Topic created',
      description: `${topic.name}`,
      timestamp: topic.createdAt,
    })
  }

  // Schema activities
  const schemas = 'docs' in recentSchemas ? recentSchemas.docs : []
  for (const schema of schemas) {
    activities.push({
      type: 'schema',
      title: schema.status === 'published' ? 'API published' : 'Schema registered',
      description: schema.name,
      timestamp: schema.updatedAt,
    })
  }

  // Doc activities
  const docs = 'docs' in recentDocs ? recentDocs.docs : []
  for (const doc of docs) {
    activities.push({
      type: 'doc',
      title: 'Doc updated',
      description: doc.title,
      timestamp: doc.updatedAt,
    })
  }

  // Sort by timestamp descending, take top 5
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const topActivities = activities.slice(0, 5)

  const userName = session?.user?.name?.split(' ')[0] || ''

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-7 p-8 stagger-reveal">
          {/* Welcome Section */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between stagger-item">
            <div className="space-y-1">
              <DashboardGreeting userName={userName} />
              <p className="text-sm text-muted-foreground">
                Here&apos;s what&apos;s happening across your workspaces
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" asChild>
                <Link href="/admin/workspaces">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New Workspace
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/templates">
                  <LayoutTemplate className="mr-1.5 h-4 w-4" />
                  Browse Templates
                </Link>
              </Button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="stagger-item">
            <DashboardStatsRow
              workspaceCount={workspaceIds.length}
              appCount={appCount}
              healthyCount={healthyCount}
              degradedCount={degradedCount}
              kafkaTopicCount={kafkaTopicCount.totalDocs}
              virtualClusterCount={virtualClusterCount.totalDocs}
              apiSchemaCount={apiSchemaCount.totalDocs}
              publishedApiCount={publishedApiCount.totalDocs}
            />
          </div>

          {/* Two-Column Layout */}
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            {/* Left Column */}
            <div className="space-y-5 stagger-item">
              <DashboardWorkspacesCard memberships={memberships} />
              <DashboardAppHealthCard apps={apps.slice(0, 5)} />
            </div>

            {/* Right Column */}
            <div className="space-y-5 stagger-item">
              <DashboardActivityFeed activities={topActivities} />
              <DashboardQuickActions />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
