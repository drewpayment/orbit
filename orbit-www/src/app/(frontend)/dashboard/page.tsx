import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Plus, LayoutTemplate } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getPayloadClient, getSession, getUserWorkspaceMemberships } from '@/lib/data/cached-queries'
import {
  DashboardGreeting,
  DashboardStatsRow,
  DashboardScorecardsCard,
  DashboardWorkspacesCard,
  DashboardActivityFeed,
  DashboardQuickActions,
  DashboardAttention,
} from '@/components/features/dashboard'
import type { Activity, ActivityKind, AttentionRun } from '@/components/features/dashboard'
import type { WorkspaceRowMeta } from '@/components/features/dashboard'
import { getScorecardReport } from '@/app/(frontend)/scorecards/reports/actions'
import { DiscoveryAttentionCard } from '@/components/features/discovery/DiscoveryAttentionCard'
import { getDiscoveryAttentionAction } from '@/app/actions/discovery-attention'

const agentRunStatusLabel: Record<string, string> = {
  starting: 'started',
  running: 'started',
  awaiting_user: 'awaiting input',
  awaiting_approval: 'awaiting approval',
  completed: 'completed',
  aborted: 'aborted',
  failed: 'failed',
  timeout: 'timed out',
}

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

  // Dashboard posture uses one explicit workspace; the full reports page exposes
  // the workspace selector. A workspace-less user receives the empty report.
  const scorecardReportPromise = getScorecardReport(workspaceIds[0] ?? '', 30)

  // Discovery proposals awaiting review (self-scopes to the session user's
  // memberships + global queue for platform admins; card hides itself at zero).
  const discoveryAttentionPromise = getDiscoveryAttentionAction()

  const [
    appsResult,
    kafkaTopicCount,
    virtualClusterCount,
    openActionItemCount,
    activeInitiativeCount,
    pendingApprovalsResult,
    recentTopics,
    recentSchemas,
    knowledgeSpacesResult,
    activeAgentRunsResult,
    recentAgentRunsResult,
    recentResolvedApprovalsResult,
  ] = hasWorkspaces
    ? await Promise.all([
        // Apps with status (used for activity feed + workspaces card app/degraded counts)
        payload.find({
          collection: 'apps',
          where: workspaceFilter,
          sort: '-updatedAt',
          limit: 100,
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
        // Open (unresolved) action items across the user's workspaces
        payload.count({
          collection: 'initiative-action-items',
          where: { ...workspaceFilter, status: { in: ['open', 'in-progress'] } },
          overrideAccess: true,
        }),
        // Active remediation initiatives
        payload.count({
          collection: 'initiatives',
          where: { ...workspaceFilter, status: { equals: 'active' } },
          overrideAccess: true,
        }),
        // Pending HITL approvals awaiting review (also feeds the attention strip)
        payload.find({
          collection: 'pending-approvals',
          where: { ...workspaceFilter, status: { equals: 'pending' } },
          sort: '-createdAt',
          limit: 5,
          depth: 1,
          overrideAccess: true,
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
        // Active agent runs (for the attention strip)
        payload.find({
          collection: 'agent-runs',
          where: { ...workspaceFilter, status: { in: ['running', 'awaiting_user', 'awaiting_approval'] } },
          sort: '-startedAt',
          limit: 5,
          depth: 1,
          overrideAccess: true,
        }),
        // Recent agent runs, any status (for activity feed)
        payload.find({
          collection: 'agent-runs',
          where: workspaceFilter,
          sort: '-startedAt',
          limit: 3,
          depth: 1,
          overrideAccess: true,
        }),
        // Recently resolved approvals (for activity feed)
        payload.find({
          collection: 'pending-approvals',
          where: { ...workspaceFilter, status: { equals: 'resolved' } },
          sort: '-resolvedAt',
          limit: 2,
          depth: 1,
          overrideAccess: true,
        }),
      ])
    : [
        { docs: [], totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { totalDocs: 0 },
        { docs: [], totalDocs: 0 },
        { docs: [] },
        { docs: [] },
        { docs: [] },
        { docs: [] },
        { docs: [] },
        { docs: [] },
      ]

  const scorecardReport = await scorecardReportPromise
  const discoveryAttention = await discoveryAttentionPromise

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

  // Standards posture — reshape the report into the presentational card/stat-row
  // contract. avgScore is null (em-dash) until something is actually scored, so a
  // real average of 0 stays distinguishable from "no data yet".
  const complianceScore = scorecardReport.kpis.scoredCount > 0 ? scorecardReport.kpis.avgScore : null
  const worstGroupsSource =
    scorecardReport.byTeam.length > 0 ? scorecardReport.byTeam : scorecardReport.byKind
  const scorecardsCardReport = {
    avgScore: complianceScore,
    scoredCount: scorecardReport.kpis.scoredCount,
    entityTotal: scorecardReport.kpis.entityTotal,
    trend: scorecardReport.trend.map((p) => ({ capturedAt: p.t, avgScore: p.v })),
    worstGroups: worstGroupsSource.map((g) => ({
      name: g.group,
      avgScore: g.avgScore,
      entityCount: g.count,
    })),
  }
  const hasScorecards = scorecardReport.scorecards.length > 0
  const openActionItems = openActionItemCount.totalDocs
  const activeInitiatives = activeInitiativeCount.totalDocs
  const pendingApprovals = pendingApprovalsResult.totalDocs

  // Build the attention strip: pending approvals + active agent runs
  const approvalDocs = 'docs' in pendingApprovalsResult ? pendingApprovalsResult.docs : []
  const activeRunDocs = 'docs' in activeAgentRunsResult ? activeAgentRunsResult.docs : []
  // Totals let the hub surface overflow when more items exist than were fetched.
  // pendingApprovals already counts only status:pending — the same set we fetch here.
  const activeRunsTotal = 'totalDocs' in activeAgentRunsResult ? activeAgentRunsResult.totalDocs : 0

  const attentionRuns: AttentionRun[] = [
    ...approvalDocs.map((appr): AttentionRun => {
      const wsName = typeof appr.workspace === 'object' ? appr.workspace?.name : undefined
      return {
        id: appr.id,
        kind: 'approval',
        title: appr.title,
        workspace: wsName ?? 'Workspace',
        startedRel: formatDistanceToNow(new Date(appr.createdAt), { addSuffix: true }),
        href: '/platform/approvals',
      }
    }),
    ...activeRunDocs.map((run): AttentionRun => {
      const wsName = typeof run.workspace === 'object' ? run.workspace?.name : undefined
      const app = typeof run.repository === 'object' ? run.repository?.name : undefined
      return {
        id: run.id,
        kind: run.status === 'running' ? 'running' : 'awaiting',
        title: run.title,
        workspace: wsName ?? 'Workspace',
        app,
        startedRel: formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }),
        href: '/agent',
      }
    }),
  ]

  // Compute per-workspace app counts + degraded counts for the workspaces card
  const metaById: Record<string, WorkspaceRowMeta> = {}
  for (const app of apps) {
    const wsId = typeof app.workspace === 'object' ? app.workspace?.id : app.workspace
    if (!wsId) continue
    const existing = metaById[wsId] ?? { apps: 0, topics: 0, schemas: 0, degraded: 0 }
    existing.apps += 1
    if (app.status === 'degraded' || app.status === 'down') {
      existing.degraded = (existing.degraded ?? 0) + 1
    }
    metaById[wsId] = existing
  }

  // Build activity feed from recent items
  const activities: Activity[] = []

  // App activities
  for (const app of apps.slice(0, 3)) {
    const wsName = typeof app.workspace === 'object' ? app.workspace?.name : undefined
    activities.push({
      type: 'app',
      kind: 'info',
      title: app.status === 'healthy' ? 'App deployed' : 'App status changed',
      description: `${app.name} in ${wsName ?? 'workspace'}`,
      workspace: wsName,
      timestamp: app.updatedAt,
    })
  }

  // Kafka topic activities
  const topics = 'docs' in recentTopics ? recentTopics.docs : []
  for (const topic of topics) {
    const wsName = typeof topic.workspace === 'object' ? topic.workspace?.name : undefined
    activities.push({
      type: 'topic',
      kind: 'info',
      title: 'Topic created',
      description: `${topic.name}`,
      workspace: wsName,
      timestamp: topic.createdAt,
    })
  }

  // Schema activities
  const schemas = 'docs' in recentSchemas ? recentSchemas.docs : []
  for (const schema of schemas) {
    const wsName = typeof schema.workspace === 'object' ? schema.workspace?.name : undefined
    activities.push({
      type: 'schema',
      kind: 'ok',
      title: schema.status === 'published' ? 'API published' : 'Schema registered',
      description: schema.name,
      workspace: wsName,
      timestamp: schema.updatedAt,
    })
  }

  // Agent run activities (recent, any status)
  const recentRuns = 'docs' in recentAgentRunsResult ? recentAgentRunsResult.docs : []
  for (const run of recentRuns) {
    const wsName = typeof run.workspace === 'object' ? run.workspace?.name : undefined
    const label = agentRunStatusLabel[run.status] ?? run.status
    const kind: ActivityKind =
      run.status === 'failed' || run.status === 'timeout'
        ? 'err'
        : run.status === 'completed'
          ? 'ok'
          : 'accent'
    activities.push({
      type: 'agent',
      kind,
      title: `Agent run ${label}`,
      description: run.title,
      workspace: wsName,
      timestamp: run.endedAt ?? run.startedAt,
    })
  }

  // Recently resolved approval activities
  const resolvedApprovals = 'docs' in recentResolvedApprovalsResult ? recentResolvedApprovalsResult.docs : []
  for (const appr of resolvedApprovals) {
    if (!appr.resolvedAt) continue
    const wsName = typeof appr.workspace === 'object' ? appr.workspace?.name : undefined
    const label = appr.resolution === 'rejected' ? 'rejected' : 'approved'
    activities.push({
      type: 'agent',
      kind: 'info',
      title: `Approval ${label}`,
      description: appr.title,
      workspace: wsName,
      timestamp: appr.resolvedAt,
    })
  }

  // Doc activities — pushed last so they rank after same-timestamp items
  // (Array.prototype.sort is stable, and this array is sorted descending below).
  const docs = 'docs' in recentDocs ? recentDocs.docs : []
  for (const doc of docs) {
    const space = typeof doc.knowledgeSpace === 'object' ? doc.knowledgeSpace : undefined
    const wsName = space && typeof space.workspace === 'object' ? space.workspace?.name : undefined
    activities.push({
      type: 'doc',
      kind: 'ok',
      title: 'Doc updated',
      description: doc.title,
      workspace: wsName,
      timestamp: doc.updatedAt,
    })
  }

  // Sort by timestamp descending, take top 6
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const topActivities = activities.slice(0, 6)

  const userName = session?.user?.name?.split(' ')[0] || ''

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex w-full min-w-0 flex-1 flex-col gap-7 p-8 stagger-reveal">
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

          {/* Attention Strip */}
          <div className="stagger-item space-y-4">
            <DashboardAttention
              runs={attentionRuns}
              approvalsTotal={pendingApprovals}
              runsTotal={activeRunsTotal}
            />
            <DiscoveryAttentionCard data={discoveryAttention} />
          </div>

          {/* Stats Row */}
          <div className="stagger-item">
            <DashboardStatsRow
              complianceScore={complianceScore}
              scoredCount={scorecardReport.kpis.scoredCount}
              entityTotal={scorecardReport.kpis.entityTotal}
              openActionItems={openActionItems}
              pendingApprovals={pendingApprovals}
              kafkaTopicCount={kafkaTopicCount.totalDocs}
              virtualClusterCount={virtualClusterCount.totalDocs}
            />
          </div>

          {/* Two-Column Layout */}
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            {/* Left Column */}
            <div className="space-y-5 stagger-item">
              <DashboardScorecardsCard
                report={scorecardsCardReport}
                openActionItems={openActionItems}
                activeInitiatives={activeInitiatives}
                hasScorecards={hasScorecards}
              />
              <DashboardWorkspacesCard memberships={memberships} metaById={metaById} />
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
