import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getPayloadClient, getSession, getUserWorkspaceMemberships } from '@/lib/data/cached-queries'
import {
  DashboardHero,
  DashboardSection,
  DashboardStatsRow,
  DashboardWorkspacesCard,
  DashboardAppHealthCard,
  DashboardActivityFeed,
  DashboardQuickActions,
  DashboardAttention,
  DashboardTemplates,
} from '@/components/features/dashboard'
import type {
  Activity,
  AttentionRun,
  TemplateRow,
  WorkspaceRowMeta,
} from '@/components/features/dashboard'

// Curated starter templates — surfaced on the dashboard before the Templates collection is wired up.
const STARTER_TEMPLATES: TemplateRow[] = [
  { id: 'static-site', name: 'Static site', description: 'Vite / Astro / Next.js export · Render', icon: 'box' },
  { id: 'go-service', name: 'Go HTTP service', description: 'Chi router · Postgres · Vault secrets', icon: 'git' },
  { id: 'kafka-consumer', name: 'Kafka consumer', description: 'Go · Schema Registry · DLQ', icon: 'wave' },
  { id: 'api-schema', name: 'API schema', description: 'OpenAPI 3.1 · auto-published catalog', icon: 'doc' },
]

export default async function DashboardPage() {
  const [payload, session] = await Promise.all([getPayloadClient(), getSession()])

  const memberships = session?.user
    ? await getUserWorkspaceMemberships(session.user.id)
    : []

  const workspaceIds = memberships
    .map((m) => (typeof m.workspace === 'object' ? m.workspace?.id : m.workspace))
    .filter((id): id is string => !!id)

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
        payload.find({
          collection: 'apps',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 25,
          depth: 1,
        }),
        payload.count({ collection: 'kafka-topics', where: workspaceFilter, overrideAccess: true }),
        payload.count({ collection: 'kafka-virtual-clusters', where: workspaceFilter, overrideAccess: true }),
        payload.count({ collection: 'api-schemas', where: workspaceFilter }),
        payload.count({
          collection: 'api-schemas',
          where: { ...workspaceFilter, status: { equals: 'published' } },
        }),
        payload.find({
          collection: 'kafka-topics',
          where: workspaceFilter,
          sort: '-createdAt',
          limit: 5,
          depth: 1,
          overrideAccess: true,
        }),
        payload.find({
          collection: 'api-schemas',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 5,
          depth: 1,
        }),
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

  // Per-workspace counts in parallel (small N — bounded by membership count)
  const perWorkspaceMeta = hasWorkspaces
    ? await Promise.all(
        workspaceIds.map(async (id) => {
          const [apps, topics, schemas] = await Promise.all([
            payload.count({ collection: 'apps', where: { workspace: { equals: id } } }),
            payload.count({ collection: 'kafka-topics', where: { workspace: { equals: id } }, overrideAccess: true }),
            payload.count({ collection: 'api-schemas', where: { workspace: { equals: id } } }),
          ])
          return [id, { apps: apps.totalDocs, topics: topics.totalDocs, schemas: schemas.totalDocs }] as const
        }),
      )
    : []

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
        limit: 5,
        depth: 1,
      })
    : { docs: [] }

  const apps = 'docs' in appsResult ? appsResult.docs : []
  const appCount = 'totalDocs' in appsResult ? appsResult.totalDocs : 0
  const healthyCount = apps.filter((a) => a.status === 'healthy').length
  const degradedCount = apps.filter((a) => a.status === 'degraded' || a.status === 'down').length
  const unknownCount = apps.filter((a) => !a.status || a.status === 'unknown').length

  // Workspace metadata (apps/topics/schemas + lastActive computed from most-recent app per workspace)
  const metaById: Record<string, WorkspaceRowMeta> = Object.fromEntries(
    perWorkspaceMeta.map(([id, counts]) => [
      id,
      { ...counts, lastActive: lastActiveForWorkspace(apps, id) },
    ]),
  )

  // Activity feed: build from real items
  const activities: Activity[] = []
  for (const app of apps.slice(0, 3)) {
    activities.push({
      type: 'app',
      kind: app.status === 'healthy' ? 'ok' : 'info',
      title: app.status === 'healthy' ? 'App deployed' : 'App status changed',
      description: app.name,
      workspace: typeof app.workspace === 'object' ? app.workspace?.name : undefined,
      timestamp: app.updatedAt,
    })
  }
  const topics = 'docs' in recentTopics ? recentTopics.docs : []
  for (const topic of topics.slice(0, 3)) {
    activities.push({
      type: 'topic',
      kind: 'info',
      title: 'Topic created',
      description: topic.name,
      workspace: typeof topic.workspace === 'object' ? topic.workspace?.name : undefined,
      timestamp: topic.createdAt,
    })
  }
  const schemas = 'docs' in recentSchemas ? recentSchemas.docs : []
  for (const schema of schemas.slice(0, 3)) {
    activities.push({
      type: 'schema',
      kind: 'ok',
      title: schema.status === 'published' ? 'API published' : 'Schema registered',
      description: schema.name,
      workspace: typeof schema.workspace === 'object' ? schema.workspace?.name : undefined,
      timestamp: schema.updatedAt,
    })
  }
  const docs = 'docs' in recentDocs ? recentDocs.docs : []
  for (const doc of docs.slice(0, 3)) {
    activities.push({
      type: 'doc',
      kind: 'ok',
      title: 'Doc updated',
      description: doc.title,
      timestamp: doc.updatedAt,
    })
  }
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const topActivities = activities.slice(0, 12)

  // In-flight agent runs — wired once the temporal infra-agent collection lands on main.
  const attentionRuns: AttentionRun[] = []

  // Primary Kafka broker hint — first virtual cluster of the membership set, when available.
  const primaryBroker = hasWorkspaces
    ? await payload
        .find({
          collection: 'kafka-virtual-clusters',
          where: workspaceFilter,
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        .then((res) => (res.docs[0] as { name?: string; slug?: string } | undefined)?.slug)
        .catch(() => undefined)
    : undefined

  const userName = session?.user?.name?.split(' ')[0] || ''
  const workspaceNames = memberships
    .map((m) => (typeof m.workspace === 'object' ? m.workspace?.name : undefined))
    .filter((n): n is string => !!n)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col px-8 pb-20 pt-7">
          <DashboardHero
            userName={userName}
            attentionCount={attentionRuns.length}
            workspaceCount={workspaceIds.length}
          />

          {attentionRuns.length > 0 && (
            <>
              <DashboardSection
                title="Needs your attention"
                count={attentionRuns.length}
                moreLabel="View all runs"
                moreHref="/agent"
              />
              <DashboardAttention runs={attentionRuns} />
            </>
          )}

          <DashboardSection title="Overview" />
          <DashboardStatsRow
            workspaceCount={workspaceIds.length}
            workspaceNames={workspaceNames}
            appCount={appCount}
            healthyCount={healthyCount}
            degradedCount={degradedCount}
            unknownCount={unknownCount}
            kafkaTopicCount={kafkaTopicCount.totalDocs}
            virtualClusterCount={virtualClusterCount.totalDocs}
            primaryBroker={primaryBroker}
            apiSchemaCount={apiSchemaCount.totalDocs}
            publishedApiCount={publishedApiCount.totalDocs}
          />

          <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <DashboardSection
                title="My workspaces"
                count={memberships.length}
                moreLabel="All workspaces"
                moreHref="/workspaces"
              />
              <DashboardWorkspacesCard memberships={memberships} metaById={metaById} />

              <DashboardSection title="Recent activity" moreLabel="Activity log" moreHref="/notifications" />
              <DashboardActivityFeed activities={topActivities} />
            </div>

            <div>
              <DashboardSection title="Quick actions" />
              <DashboardQuickActions />

              <div className="mt-4">
                <DashboardAppHealthCard apps={apps.slice(0, 5)} />
              </div>

              <div className="mt-4">
                <DashboardTemplates templates={STARTER_TEMPLATES} />
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function lastActiveForWorkspace(apps: Array<{ workspace?: unknown; updatedAt: string }>, workspaceId: string): string | undefined {
  for (const app of apps) {
    const wsId = typeof app.workspace === 'object' && app.workspace !== null && 'id' in app.workspace
      ? (app.workspace as { id: string }).id
      : (app.workspace as string | undefined)
    if (wsId === workspaceId) {
      const diff = Date.now() - new Date(app.updatedAt).getTime()
      return formatShortRel(diff)
    }
  }
  return undefined
}

function formatShortRel(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}
