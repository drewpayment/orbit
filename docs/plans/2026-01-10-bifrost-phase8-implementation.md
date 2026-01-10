# Bifrost Phase 8: Lineage & Observability - Implementation Plan

**Status:** READY FOR IMPLEMENTATION
**Date:** 2026-01-10
**Phase:** 8 of 10
**Dependencies:** Phase 1-7 (Foundation through Schema Registry & Consumer Groups)

## Overview

Implement data lineage tracking and visualization. Teams can see which applications produce to and consume from their topics, with aggregated volume metrics. This enables understanding data flow across the platform.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Lineage data source | Bifrost client activity tracking (gateway layer) |
| Aggregation level | Per service-account + topic + direction |
| Time windows | Rolling aggregation with hourly rollups |
| Visualization | Graph view (D3/React Flow) + table view |
| Cross-workspace visibility | Show external consumers with workspace name |
| Update frequency | Near real-time via Bifrost callbacks + hourly rollups |

## Data Model

### KafkaClientActivity Collection (Extended)

The existing `KafkaClientActivity` collection tracks individual activity events. For lineage, we need aggregated statistics.

```typescript
// Existing fields retained:
{
  workspace: Relationship<Workspace>
  topic: Relationship<KafkaTopic>
  cluster: Relationship<KafkaCluster>
  activityType: 'produce' | 'consume' | 'admin'
  clientId: string
  consumerGroup: string
  sourceWorkspace: Relationship<Workspace>
  serviceAccount: Relationship<KafkaServiceAccount>
  share: Relationship<KafkaTopicShare>
  timestamp: Date
  metadata: JSON
  ipAddress: string
}

// New fields to add:
{
  // Bifrost integration
  virtualCluster: Relationship<KafkaVirtualCluster>
  application: Relationship<KafkaApplication>

  // Volume metrics
  bytesTransferred: number    // bytes in this activity window
  messageCount: number        // messages in this activity window
}
```

### KafkaLineageEdge Collection (New)

Aggregated lineage data for visualization. One record per unique producer/consumer connection to a topic.

```typescript
{
  id: string

  // Source (who is producing/consuming)
  sourceApplication: Relationship<KafkaApplication>
  sourceServiceAccount: Relationship<KafkaServiceAccount>
  sourceWorkspace: Relationship<Workspace>

  // Target (the topic)
  topic: Relationship<KafkaTopic>
  targetApplication: Relationship<KafkaApplication>   // topic owner
  targetWorkspace: Relationship<Workspace>            // topic owner workspace

  // Edge properties
  direction: 'produce' | 'consume'

  // Aggregated metrics (rolling 24h + all-time)
  bytesLast24h: number
  messagesLast24h: number
  bytesAllTime: number
  messagesAllTime: number

  // Timestamps
  firstSeen: Date
  lastSeen: Date

  // Status
  isActive: boolean           // seen in last 24h
  isCrossWorkspace: boolean   // source workspace != topic workspace

  createdAt: Date
  updatedAt: Date
}
```

### KafkaLineageSnapshot Collection (New)

Historical snapshots for trend analysis.

```typescript
{
  id: string
  topic: Relationship<KafkaTopic>
  snapshotDate: Date          // truncated to day

  // Aggregated stats for the day
  producers: Array<{
    application: string
    serviceAccount: string
    workspace: string
    bytes: number
    messages: number
  }>
  consumers: Array<{
    application: string
    serviceAccount: string
    workspace: string
    bytes: number
    messages: number
  }>

  // Summary stats
  totalBytesIn: number
  totalBytesOut: number
  totalMessagesIn: number
  totalMessagesOut: number
  producerCount: number
  consumerCount: number

  createdAt: Date
}
```

## Implementation Tasks

### Task 1: Extend KafkaClientActivity Collection

**Files:**
- `orbit-www/src/collections/kafka/KafkaClientActivity.ts` (update)

**Implementation:**
- Add `virtualCluster` relationship field to KafkaVirtualClusters
- Add `application` relationship field to KafkaApplications
- Add `bytesTransferred` number field (default 0)
- Add `messageCount` number field (default 0)
- Add compound index on (topic, serviceAccount, activityType) for aggregation queries

**Verification:**
- [ ] Collection accepts new fields
- [ ] Indexes created for efficient querying
- [ ] Migrations run successfully

---

### Task 2: Create KafkaLineageEdge Collection

**Files:**
- `orbit-www/src/collections/kafka/KafkaLineageEdge.ts` (new)
- `orbit-www/src/collections/kafka/index.ts` (update exports)
- `orbit-www/src/payload.config.ts` (add to collections)

**Implementation:**
```typescript
export const KafkaLineageEdge: CollectionConfig = {
  slug: 'kafka-lineage-edges',
  admin: {
    useAsTitle: 'id',
    group: 'Kafka',
    defaultColumns: ['sourceApplication', 'direction', 'topic', 'lastSeen'],
    description: 'Aggregated data flow relationships between applications and topics',
  },
  access: {
    // Read: users can see edges for topics in their workspaces
    read: workspaceTopicAccess,
    // System-generated only
    create: systemOnly,
    update: systemOnly,
    delete: systemOnly,
  },
  fields: [
    // Source fields
    { name: 'sourceApplication', type: 'relationship', relationTo: 'kafka-applications', index: true },
    { name: 'sourceServiceAccount', type: 'relationship', relationTo: 'kafka-service-accounts', index: true },
    { name: 'sourceWorkspace', type: 'relationship', relationTo: 'workspaces', index: true },

    // Target fields
    { name: 'topic', type: 'relationship', relationTo: 'kafka-topics', required: true, index: true },
    { name: 'targetApplication', type: 'relationship', relationTo: 'kafka-applications', index: true },
    { name: 'targetWorkspace', type: 'relationship', relationTo: 'workspaces', required: true, index: true },

    // Edge properties
    { name: 'direction', type: 'select', options: ['produce', 'consume'], required: true, index: true },

    // Metrics
    { name: 'bytesLast24h', type: 'number', defaultValue: 0 },
    { name: 'messagesLast24h', type: 'number', defaultValue: 0 },
    { name: 'bytesAllTime', type: 'number', defaultValue: 0 },
    { name: 'messagesAllTime', type: 'number', defaultValue: 0 },

    // Timestamps
    { name: 'firstSeen', type: 'date', required: true },
    { name: 'lastSeen', type: 'date', required: true, index: true },

    // Status
    { name: 'isActive', type: 'checkbox', defaultValue: true, index: true },
    { name: 'isCrossWorkspace', type: 'checkbox', defaultValue: false, index: true },
  ],
  indexes: [
    { name: 'topic_direction_idx', fields: ['topic', 'direction'] },
    { name: 'source_app_idx', fields: ['sourceApplication', 'direction'] },
  ],
  timestamps: true,
}
```

**Verification:**
- [ ] Collection appears in Payload admin
- [ ] Can create edge records programmatically
- [ ] Indexes created for efficient querying

---

### Task 3: Create KafkaLineageSnapshot Collection

**Files:**
- `orbit-www/src/collections/kafka/KafkaLineageSnapshot.ts` (new)
- `orbit-www/src/collections/kafka/index.ts` (update exports)
- `orbit-www/src/payload.config.ts` (add to collections)

**Implementation:**
- Create collection with schema from data model
- Indexed on (topic, snapshotDate) for efficient historical queries
- Access: read for workspace members, create/update for system only

**Verification:**
- [ ] Collection appears in Payload admin
- [ ] Can create snapshot records
- [ ] Unique constraint on (topic, snapshotDate)

---

### Task 4: Implement Bifrost Client Activity Tracking

**Files:**
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filters/ActivityTrackingFilter.kt` (new)
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/ActivityEmitter.kt` (new)

**Implementation:**
The Bifrost gateway needs to track client activity and emit it to Orbit:

```kotlin
// ActivityTrackingFilter - intercepts Produce and Fetch requests
class ActivityTrackingFilter : KroxyliciousFilter {
    // Track per-connection metrics
    private val connectionMetrics = ConcurrentHashMap<ConnectionId, ActivityMetrics>()

    override fun onProduce(request: ProduceRequest) {
        val metrics = connectionMetrics.getOrPut(connectionId) { ActivityMetrics() }
        metrics.addProduceActivity(
            topic = request.topic,
            bytes = request.totalBytes,
            messageCount = request.recordCount
        )
    }

    override fun onFetch(response: FetchResponse) {
        val metrics = connectionMetrics.getOrPut(connectionId) { ActivityMetrics() }
        metrics.addConsumeActivity(
            topics = response.topics,
            bytes = response.totalBytes,
            messageCount = response.recordCount
        )
    }
}

// ActivityEmitter - batches and sends to Orbit
class ActivityEmitter {
    // Batch and emit every 30 seconds
    @Scheduled(fixedDelay = 30_000)
    fun emitBatch() {
        val batch = collectAndResetMetrics()
        bifrostCallbackClient.emitClientActivity(batch)
    }
}
```

**Verification:**
- [ ] Produce requests tracked with bytes/messages
- [ ] Fetch responses tracked with bytes/messages
- [ ] Metrics batched and emitted periodically
- [ ] Performance impact < 1ms p99 latency

---

### Task 5: Add Proto Messages for Activity Callbacks

**Files:**
- `proto/idp/gateway/v1/gateway.proto` (update)

**Implementation:**
Add to BifrostCallbackService:

```protobuf
// Add to BifrostCallbackService
rpc EmitClientActivity(EmitClientActivityRequest) returns (EmitClientActivityResponse);

message ClientActivityRecord {
  string virtual_cluster_id = 1;
  string service_account_id = 2;
  string topic_virtual_name = 3;
  string direction = 4;  // "produce" or "consume"
  string consumer_group_id = 5;  // for consume only
  int64 bytes = 6;
  int64 message_count = 7;
  google.protobuf.Timestamp window_start = 8;
  google.protobuf.Timestamp window_end = 9;
}

message EmitClientActivityRequest {
  repeated ClientActivityRecord records = 1;
}

message EmitClientActivityResponse {}
```

Run `make proto-gen` after changes.

**Verification:**
- [ ] Proto compiles successfully
- [ ] Go types generated in `proto/gen/go/`
- [ ] TypeScript types generated in `orbit-www/src/lib/proto/`

---

### Task 6: Implement BifrostCallbackService Activity Handler

**Files:**
- `services/bifrost-callback/internal/grpc/activity_handler.go` (new or update)
- `services/bifrost-callback/internal/service/activity_service.go` (new)

**Implementation:**
```go
func (s *ActivityService) ProcessActivityBatch(ctx context.Context, records []ClientActivityRecord) error {
    for _, record := range records {
        // 1. Resolve virtual cluster to application
        vc, err := s.resolveVirtualCluster(ctx, record.VirtualClusterId)
        if err != nil {
            continue // log and skip
        }

        // 2. Resolve service account
        sa, err := s.resolveServiceAccount(ctx, record.ServiceAccountId)
        if err != nil {
            continue
        }

        // 3. Resolve topic
        topic, err := s.resolveTopic(ctx, vc.Id, record.TopicVirtualName)
        if err != nil {
            continue
        }

        // 4. Upsert lineage edge
        err = s.upsertLineageEdge(ctx, LineageEdgeInput{
            SourceApplication: vc.ApplicationId,
            SourceServiceAccount: sa.Id,
            SourceWorkspace: vc.WorkspaceId,
            Topic: topic.Id,
            TargetApplication: topic.ApplicationId,
            TargetWorkspace: topic.WorkspaceId,
            Direction: record.Direction,
            Bytes: record.Bytes,
            MessageCount: record.MessageCount,
            Timestamp: record.WindowEnd,
        })
        if err != nil {
            log.Error("failed to upsert lineage edge", "error", err)
        }

        // 5. Create activity record for audit trail
        err = s.createActivityRecord(ctx, record, vc, sa, topic)
        if err != nil {
            log.Error("failed to create activity record", "error", err)
        }
    }
    return nil
}
```

**Verification:**
- [ ] Activity records created in KafkaClientActivity
- [ ] Lineage edges upserted correctly
- [ ] Cross-workspace flag set correctly
- [ ] Metrics aggregated properly

---

### Task 7: Implement Lineage Edge Upsert Logic

**Files:**
- `orbit-www/src/lib/kafka/lineage.ts` (new)
- `orbit-www/src/app/actions/kafka-lineage.ts` (new)

**Implementation:**
```typescript
// lineage.ts
export async function upsertLineageEdge(
  payload: Payload,
  input: {
    sourceApplication: string
    sourceServiceAccount: string
    sourceWorkspace: string
    topic: string
    targetApplication: string
    targetWorkspace: string
    direction: 'produce' | 'consume'
    bytes: number
    messageCount: number
    timestamp: Date
  }
): Promise<void> {
  // Find existing edge
  const existing = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      sourceServiceAccount: { equals: input.sourceServiceAccount },
      topic: { equals: input.topic },
      direction: { equals: input.direction },
    },
    limit: 1,
  })

  const now = new Date()
  const isCrossWorkspace = input.sourceWorkspace !== input.targetWorkspace

  if (existing.docs.length > 0) {
    // Update existing edge
    const edge = existing.docs[0]
    await payload.update({
      collection: 'kafka-lineage-edges',
      id: edge.id,
      data: {
        bytesLast24h: edge.bytesLast24h + input.bytes,  // Will be reset by rollup
        messagesLast24h: edge.messagesLast24h + input.messageCount,
        bytesAllTime: edge.bytesAllTime + input.bytes,
        messagesAllTime: edge.messagesAllTime + input.messageCount,
        lastSeen: input.timestamp,
        isActive: true,
      },
    })
  } else {
    // Create new edge
    await payload.create({
      collection: 'kafka-lineage-edges',
      data: {
        sourceApplication: input.sourceApplication,
        sourceServiceAccount: input.sourceServiceAccount,
        sourceWorkspace: input.sourceWorkspace,
        topic: input.topic,
        targetApplication: input.targetApplication,
        targetWorkspace: input.targetWorkspace,
        direction: input.direction,
        bytesLast24h: input.bytes,
        messagesLast24h: input.messageCount,
        bytesAllTime: input.bytes,
        messagesAllTime: input.messageCount,
        firstSeen: input.timestamp,
        lastSeen: input.timestamp,
        isActive: true,
        isCrossWorkspace,
      },
    })
  }
}
```

**Verification:**
- [ ] New edges created correctly
- [ ] Existing edges updated with accumulated metrics
- [ ] Cross-workspace flag calculated correctly
- [ ] firstSeen preserved, lastSeen updated

---

### Task 8: Implement Lineage Aggregation Workflow (Temporal)

**Files:**
- `temporal-workflows/internal/kafka/lineage_aggregation_workflow.go` (new)
- `temporal-workflows/internal/kafka/lineage_aggregation_activities.go` (new)

**Implementation:**
```go
// LineageAggregationWorkflow runs hourly to:
// 1. Reset 24h metrics for edges not seen recently
// 2. Mark inactive edges (not seen in 24h)
// 3. Create daily snapshots at midnight
func LineageAggregationWorkflow(ctx workflow.Context) error {
    // Activity 1: Reset stale 24h metrics
    err := workflow.ExecuteActivity(ctx, ResetStale24hMetrics).Get(ctx, nil)
    if err != nil {
        return err
    }

    // Activity 2: Mark inactive edges
    err = workflow.ExecuteActivity(ctx, MarkInactiveEdges).Get(ctx, nil)
    if err != nil {
        return err
    }

    // Activity 3: Create daily snapshot (if midnight hour)
    hour := workflow.Now(ctx).Hour()
    if hour == 0 {
        err = workflow.ExecuteActivity(ctx, CreateDailySnapshots).Get(ctx, nil)
        if err != nil {
            return err
        }
    }

    return nil
}
```

Schedule: Every hour via Temporal schedule.

**Verification:**
- [ ] Workflow runs on schedule
- [ ] Stale 24h metrics reset correctly
- [ ] Inactive edges marked after 24h
- [ ] Daily snapshots created at midnight

---

### Task 9: Implement Lineage Query Functions

**Files:**
- `orbit-www/src/lib/kafka/lineage-queries.ts` (new)

**Implementation:**
```typescript
// Get lineage for a specific topic
export async function getTopicLineage(
  payload: Payload,
  topicId: string
): Promise<{
  producers: LineageEdge[]
  consumers: LineageEdge[]
  totalBytesIn24h: number
  totalBytesOut24h: number
}> {
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      topic: { equals: topicId },
      isActive: { equals: true },
    },
    depth: 2,  // Populate application and workspace
  })

  const producers = edges.docs.filter(e => e.direction === 'produce')
  const consumers = edges.docs.filter(e => e.direction === 'consume')

  return {
    producers,
    consumers,
    totalBytesIn24h: producers.reduce((sum, e) => sum + e.bytesLast24h, 0),
    totalBytesOut24h: consumers.reduce((sum, e) => sum + e.bytesLast24h, 0),
  }
}

// Get lineage for an application (all topics it touches)
export async function getApplicationLineage(
  payload: Payload,
  applicationId: string
): Promise<{
  producing: LineageEdge[]  // topics this app produces to
  consuming: LineageEdge[]  // topics this app consumes from
}> {
  const edges = await payload.find({
    collection: 'kafka-lineage-edges',
    where: {
      sourceApplication: { equals: applicationId },
      isActive: { equals: true },
    },
    depth: 2,
  })

  return {
    producing: edges.docs.filter(e => e.direction === 'produce'),
    consuming: edges.docs.filter(e => e.direction === 'consume'),
  }
}

// Get historical lineage trends
export async function getLineageTrend(
  payload: Payload,
  topicId: string,
  days: number = 30
): Promise<KafkaLineageSnapshot[]> {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  return payload.find({
    collection: 'kafka-lineage-snapshots',
    where: {
      topic: { equals: topicId },
      snapshotDate: { greater_than_equal: startDate },
    },
    sort: 'snapshotDate',
  }).then(r => r.docs)
}
```

**Verification:**
- [ ] Topic lineage returns producers and consumers
- [ ] Application lineage shows all connected topics
- [ ] Historical trends return correct date range
- [ ] Cross-workspace edges included with external label

---

### Task 10: Create Lineage Server Actions

**Files:**
- `orbit-www/src/app/actions/kafka-lineage.ts` (new)

**Implementation:**
```typescript
'use server'

export async function getTopicLineageAction(topicId: string) {
  const payload = await getPayloadClient()
  // Verify user has access to topic
  const topic = await payload.findByID({
    collection: 'kafka-topics',
    id: topicId,
  })
  if (!topic) throw new Error('Topic not found')

  return getTopicLineage(payload, topicId)
}

export async function getApplicationLineageAction(applicationId: string) {
  const payload = await getPayloadClient()
  // Verify user has access to application
  const app = await payload.findByID({
    collection: 'kafka-applications',
    id: applicationId,
  })
  if (!app) throw new Error('Application not found')

  return getApplicationLineage(payload, applicationId)
}

export async function getLineageTrendAction(topicId: string, days?: number) {
  const payload = await getPayloadClient()
  // Verify access
  const topic = await payload.findByID({
    collection: 'kafka-topics',
    id: topicId,
  })
  if (!topic) throw new Error('Topic not found')

  return getLineageTrend(payload, topicId, days)
}
```

**Verification:**
- [ ] Actions enforce authorization
- [ ] Actions return correctly typed data
- [ ] Error handling for missing resources

---

### Task 11: Create LineageGraph Component

**Files:**
- `orbit-www/src/components/features/kafka/LineageGraph.tsx` (new)
- `orbit-www/src/components/features/kafka/LineageNode.tsx` (new)
- `orbit-www/src/components/features/kafka/LineageEdge.tsx` (new)

**Implementation:**
Use React Flow for the graph visualization:

```typescript
// LineageGraph.tsx
interface LineageGraphProps {
  topic: KafkaTopic
  producers: LineageEdge[]
  consumers: LineageEdge[]
}

export function LineageGraph({ topic, producers, consumers }: LineageGraphProps) {
  const nodes: Node[] = useMemo(() => {
    const topicNode = {
      id: `topic-${topic.id}`,
      type: 'topic',
      data: { topic },
      position: { x: 400, y: 200 },
    }

    const producerNodes = producers.map((edge, i) => ({
      id: `producer-${edge.id}`,
      type: 'application',
      data: { edge, direction: 'produce' },
      position: { x: 100, y: 50 + i * 100 },
    }))

    const consumerNodes = consumers.map((edge, i) => ({
      id: `consumer-${edge.id}`,
      type: 'application',
      data: { edge, direction: 'consume' },
      position: { x: 700, y: 50 + i * 100 },
    }))

    return [topicNode, ...producerNodes, ...consumerNodes]
  }, [topic, producers, consumers])

  const edges: Edge[] = useMemo(() => [
    ...producers.map(p => ({
      id: `edge-${p.id}`,
      source: `producer-${p.id}`,
      target: `topic-${topic.id}`,
      animated: p.isActive,
      label: formatBytes(p.bytesLast24h),
    })),
    ...consumers.map(c => ({
      id: `edge-${c.id}`,
      source: `topic-${topic.id}`,
      target: `consumer-${c.id}`,
      animated: c.isActive,
      label: formatBytes(c.bytesLast24h),
    })),
  ], [topic, producers, consumers])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
    />
  )
}
```

**Verification:**
- [ ] Graph renders with topic in center
- [ ] Producers shown on left, consumers on right
- [ ] Edges show volume labels
- [ ] Animated edges for active connections
- [ ] Cross-workspace nodes styled differently

---

### Task 12: Create LineageTable Component

**Files:**
- `orbit-www/src/components/features/kafka/LineageTable.tsx` (new)

**Implementation:**
```typescript
interface LineageTableProps {
  edges: LineageEdge[]
  direction: 'producers' | 'consumers'
}

export function LineageTable({ edges, direction }: LineageTableProps) {
  const columns = [
    { header: 'Application', accessor: 'sourceApplication.name' },
    { header: 'Service Account', accessor: 'sourceServiceAccount.name' },
    { header: 'Workspace', accessor: 'sourceWorkspace.name' },
    { header: 'Volume (24h)', accessor: 'bytesLast24h', format: formatBytes },
    { header: 'Messages (24h)', accessor: 'messagesLast24h', format: formatNumber },
    { header: 'First Seen', accessor: 'firstSeen', format: formatDate },
    { header: 'Last Seen', accessor: 'lastSeen', format: formatRelativeTime },
    { header: 'Status', accessor: 'isActive', format: (v) => v ? 'Active' : 'Inactive' },
  ]

  return (
    <DataTable
      data={edges}
      columns={columns}
      emptyMessage={`No ${direction} found`}
    />
  )
}
```

**Verification:**
- [ ] Table shows all edge data
- [ ] Bytes formatted as human-readable (KB, MB, GB)
- [ ] Dates formatted appropriately
- [ ] Sortable columns
- [ ] Cross-workspace rows marked with badge

---

### Task 13: Create TopicLineagePanel Component

**Files:**
- `orbit-www/src/components/features/kafka/TopicLineagePanel.tsx` (new)

**Implementation:**
```typescript
interface TopicLineagePanelProps {
  topicId: string
}

export function TopicLineagePanel({ topicId }: TopicLineagePanelProps) {
  const [lineage, setLineage] = useState<TopicLineageData | null>(null)
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getTopicLineageAction(topicId)
      .then(setLineage)
      .finally(() => setIsLoading(false))
  }, [topicId])

  if (isLoading) return <Skeleton />
  if (!lineage) return <EmptyState message="No lineage data available" />

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3>Data Lineage</h3>
          <p className="text-sm text-muted-foreground">
            {lineage.producers.length} producers, {lineage.consumers.length} consumers
          </p>
        </div>
        <ToggleGroup value={viewMode} onValueChange={setViewMode}>
          <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
          <ToggleGroupItem value="table">Table</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatCard title="Bytes In (24h)" value={formatBytes(lineage.totalBytesIn24h)} />
        <StatCard title="Bytes Out (24h)" value={formatBytes(lineage.totalBytesOut24h)} />
      </div>

      {viewMode === 'graph' ? (
        <LineageGraph
          topic={lineage.topic}
          producers={lineage.producers}
          consumers={lineage.consumers}
        />
      ) : (
        <Tabs defaultValue="producers">
          <TabsList>
            <TabsTrigger value="producers">Producers ({lineage.producers.length})</TabsTrigger>
            <TabsTrigger value="consumers">Consumers ({lineage.consumers.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="producers">
            <LineageTable edges={lineage.producers} direction="producers" />
          </TabsContent>
          <TabsContent value="consumers">
            <LineageTable edges={lineage.consumers} direction="consumers" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
```

**Verification:**
- [ ] Panel loads lineage data
- [ ] Toggle between graph and table views
- [ ] Summary stats displayed
- [ ] Empty state when no lineage data

---

### Task 14: Create ApplicationLineagePage

**Files:**
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/applications/[slug]/lineage/page.tsx` (new)

**Implementation:**
```typescript
export default async function ApplicationLineagePage({
  params,
}: {
  params: { workspace: string; slug: string }
}) {
  const application = await getKafkaApplicationBySlug(params.workspace, params.slug)
  if (!application) notFound()

  const lineage = await getApplicationLineageAction(application.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Lineage"
        description={`Data flow for ${application.name}`}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Topics This App Produces To</CardTitle>
            <CardDescription>{lineage.producing.length} topics</CardDescription>
          </CardHeader>
          <CardContent>
            <LineageTable edges={lineage.producing} direction="producers" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Topics This App Consumes From</CardTitle>
            <CardDescription>{lineage.consuming.length} topics</CardDescription>
          </CardHeader>
          <CardContent>
            <LineageTable edges={lineage.consuming} direction="consumers" />
          </CardContent>
        </Card>
      </div>

      <ApplicationLineageGraph application={application} lineage={lineage} />
    </div>
  )
}
```

**Verification:**
- [ ] Page loads application lineage
- [ ] Shows producing and consuming topics
- [ ] Graph view shows full data flow
- [ ] Navigation from application detail page works

---

### Task 15: Add Lineage Tab to Topic Detail Page

**Files:**
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/applications/[slug]/topics/[topicId]/page.tsx` (update)

**Implementation:**
- Add "Lineage" tab alongside existing tabs (Overview, Configuration, etc.)
- Tab content renders TopicLineagePanel

**Verification:**
- [ ] Lineage tab appears in topic detail
- [ ] Tab loads lineage panel correctly
- [ ] Tab preserves URL state

---

### Task 16: Add Lineage Link to Application Navigation

**Files:**
- `orbit-www/src/components/features/kafka/ApplicationNav.tsx` (update, if exists)
- Or appropriate navigation component

**Implementation:**
- Add "Lineage" link in application detail navigation
- Shows between "Usage" and "Settings"

**Verification:**
- [ ] Link appears in navigation
- [ ] Active state works correctly

---

### Task 17: Integration Tests

**Files:**
- `orbit-www/src/tests/kafka-lineage.test.ts` (new)
- `services/bifrost-callback/tests/activity_test.go` (new)

**Implementation:**
- Test lineage edge upsert logic (new and update)
- Test lineage query functions
- Test activity processing from Bifrost
- Test cross-workspace edge detection
- Test aggregation workflow logic

**Verification:**
- [ ] All tests pass
- [ ] Edge cases covered (first activity, updates, cross-workspace)
- [ ] Performance acceptable for batch processing

---

## File Summary

### New Files (14)
- `orbit-www/src/collections/kafka/KafkaLineageEdge.ts`
- `orbit-www/src/collections/kafka/KafkaLineageSnapshot.ts`
- `orbit-www/src/lib/kafka/lineage.ts`
- `orbit-www/src/lib/kafka/lineage-queries.ts`
- `orbit-www/src/app/actions/kafka-lineage.ts`
- `orbit-www/src/components/features/kafka/LineageGraph.tsx`
- `orbit-www/src/components/features/kafka/LineageNode.tsx`
- `orbit-www/src/components/features/kafka/LineageEdge.tsx`
- `orbit-www/src/components/features/kafka/LineageTable.tsx`
- `orbit-www/src/components/features/kafka/TopicLineagePanel.tsx`
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/applications/[slug]/lineage/page.tsx`
- `temporal-workflows/internal/kafka/lineage_aggregation_workflow.go`
- `temporal-workflows/internal/kafka/lineage_aggregation_activities.go`
- `orbit-www/src/tests/kafka-lineage.test.ts`

### Modified Files (7)
- `orbit-www/src/collections/kafka/KafkaClientActivity.ts`
- `orbit-www/src/collections/kafka/index.ts`
- `orbit-www/src/payload.config.ts`
- `proto/idp/gateway/v1/gateway.proto`
- `gateway/bifrost/` (new filter and emitter classes)
- `services/bifrost-callback/` (activity handler)
- Topic detail page (add lineage tab)

### Bifrost Changes (2)
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/filters/ActivityTrackingFilter.kt`
- `gateway/bifrost/src/main/kotlin/io/orbit/bifrost/metrics/ActivityEmitter.kt`

## Success Criteria

1. [ ] Bifrost tracks produce/consume activity with bytes and message counts
2. [ ] Activity data flows to Orbit via callback service
3. [ ] Lineage edges created and updated from activity data
4. [ ] Topic lineage page shows producers and consumers
5. [ ] Application lineage page shows all connected topics
6. [ ] Graph visualization renders correctly
7. [ ] Table view shows detailed metrics
8. [ ] Cross-workspace connections clearly marked
9. [ ] Historical snapshots created daily
10. [ ] All tests pass

## Dependencies

- **Phase 7**: Schema Registry & Consumer Groups must be complete for full lineage context
- **React Flow**: Install as dependency (`pnpm add reactflow`)
- **Temporal**: Scheduler for aggregation workflow
