import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getPayloadClient, getSession, getUserWorkspaceMemberships } from '@/lib/data/cached-queries'
import type { Activity } from '@/components/features/dashboard'
import { Activity as ActivityIcon } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const typeLabels: Record<Activity['type'], string> = {
  app: 'App',
  topic: 'Kafka',
  schema: 'API',
  doc: 'Docs',
}

const typeColors: Record<Activity['type'], string> = {
  app: 'bg-green-500',
  topic: 'bg-blue-500',
  schema: 'bg-purple-500',
  doc: 'bg-green-500',
}

export default async function NotificationsPage() {
  const [payload, session] = await Promise.all([
    getPayloadClient(),
    getSession(),
  ])

  const memberships = session?.user
    ? await getUserWorkspaceMemberships(session.user.id)
    : []

  const workspaceIds = memberships
    .map((m) => (typeof m.workspace === 'object' ? m.workspace?.id : m.workspace))
    .filter((id): id is string => !!id)

  const hasWorkspaces = workspaceIds.length > 0
  const workspaceFilter = { workspace: { in: workspaceIds } }

  const [appsResult, recentTopics, recentSchemas, knowledgeSpacesResult] = hasWorkspaces
    ? await Promise.all([
        payload.find({
          collection: 'apps',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 20,
          depth: 1,
        }),
        payload.find({
          collection: 'kafka-topics',
          where: workspaceFilter,
          sort: '-createdAt',
          limit: 20,
          depth: 1,
          overrideAccess: true,
        }),
        payload.find({
          collection: 'api-schemas',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 20,
          depth: 1,
        }),
        payload.find({
          collection: 'knowledge-spaces',
          where: workspaceFilter,
          limit: 100,
        }),
      ])
    : [
        { docs: [] },
        { docs: [] },
        { docs: [] },
        { docs: [] },
      ]

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
        limit: 20,
        depth: 1,
      })
    : { docs: [] }

  // Build activity feed
  const activities: Activity[] = []

  const apps = 'docs' in appsResult ? appsResult.docs : []
  for (const app of apps) {
    activities.push({
      type: 'app',
      title: app.status === 'healthy' ? 'App deployed' : 'App status changed',
      description: `${app.name} in ${typeof app.workspace === 'object' ? app.workspace?.name : 'workspace'}`,
      timestamp: app.updatedAt,
    })
  }

  const topics = 'docs' in recentTopics ? recentTopics.docs : []
  for (const topic of topics) {
    activities.push({
      type: 'topic',
      title: 'Topic created',
      description: topic.name,
      timestamp: topic.createdAt,
    })
  }

  const schemas = 'docs' in recentSchemas ? recentSchemas.docs : []
  for (const schema of schemas) {
    activities.push({
      type: 'schema',
      title: schema.status === 'published' ? 'API published' : 'Schema registered',
      description: schema.name,
      timestamp: schema.updatedAt,
    })
  }

  const docs = 'docs' in recentDocs ? recentDocs.docs : []
  for (const doc of docs) {
    activities.push({
      type: 'doc',
      title: 'Doc updated',
      description: doc.title,
      timestamp: doc.updatedAt,
    })
  }

  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-6 p-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Recent activity across your workspaces
            </p>
          </div>

          {activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ActivityIcon className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No recent activity</p>
            </div>
          ) : (
            <div className="max-w-3xl space-y-1">
              {activities.map((activity, index) => (
                <div
                  key={`${activity.type}-${activity.timestamp}-${index}`}
                  className="flex items-start gap-4 rounded-lg p-3 transition-colors hover:bg-muted/50"
                >
                  <span className={`mt-2 h-2 w-2 rounded-full ${typeColors[activity.type]} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium">{activity.title}</p>
                      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                        {typeLabels[activity.type]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{activity.description}</p>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
