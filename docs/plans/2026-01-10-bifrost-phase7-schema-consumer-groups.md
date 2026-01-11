# Bifrost Phase 7: Schema Registry & Consumer Groups

**Status:** APPROVED
**Date:** 2026-01-10
**Authors:** Platform Engineering

## 1. Overview

Phase 7 implements Schema Registry integration and Consumer Group tracking for the Kafka Gateway Self-Service platform. This phase focuses on **pull-based synchronization** using Temporal workflows to sync data from Schema Registry and Kafka brokers into Orbit's Payload CMS.

### Scope

| Task | Description | Approach |
|------|-------------|----------|
| 7.1 | Schema Registry subject rewriting in Bifrost | **Deferred** - not needed for pull-based sync |
| 7.2 | SchemaSyncWorkflow | Temporal workflow polling Schema Registry |
| 7.3 | Schemas UI with version history | Full-featured pages with filtering, search, diff |
| 7.4 | JoinGroup interception in Bifrost | **Deferred** - not needed for pull-based sync |
| 7.5 | ConsumerGroupSyncWorkflow | Temporal workflow polling Kafka Admin API |
| 7.6 | ConsumerLagCheckWorkflow | Temporal workflow calculating lag |
| 7.7 | Consumer groups UI with lag display | Full-featured pages with charts, filtering |

### Architecture Decision

**Pull-based (Orbit polls)** was chosen for MVP:
- Simpler implementation - no Bifrost filter changes required
- Decoupled systems - Orbit works independently of Bifrost's readiness
- Proven pattern - aligns with existing Temporal workflows in codebase
- Easy to extend - can add push-based callbacks later as optimization

**Workflow pattern:** Global singleton that iterates through all clusters sequentially. Can partition per-cluster later when scale requires it.

---

## 2. Temporal Workflows & Activities

### 2.1 SchemaSyncWorkflow

**Purpose:** Periodically sync all schemas from Schema Registry instances to Payload CMS.

**Schedule:** Every 5 minutes (configurable)

**Task Queue:** `kafka-schema-sync`

```
┌─────────────────────────────────────────────────────────────────┐
│                     SchemaSyncWorkflow                          │
├─────────────────────────────────────────────────────────────────┤
│  1. FetchClustersActivity                                       │
│     → Query Payload: all KafkaClusters with schemaRegistryUrl   │
│                                                                 │
│  2. For each cluster (sequential):                              │
│     ├── FetchSubjectsActivity                                   │
│     │   → GET /subjects from Schema Registry                    │
│     │   → Filter by known virtual cluster prefixes              │
│     │                                                           │
│     ├── For each subject (batched, 10 concurrent):              │
│     │   └── SyncSchemaVersionsActivity                          │
│     │       → GET /subjects/{subject}/versions                  │
│     │       → For each version: GET /subjects/{subject}/versions/{v}
│     │       → Parse: environment.workspace.topic-type           │
│     │       → Upsert to KafkaSchemas (idempotent)               │
│     │       → Upsert to KafkaSchemaVersions (all versions)      │
│     │                                                           │
│     └── MarkStaleSchemasActivity                                │
│         → Find KafkaSchemas not seen in this sync               │
│         → Update status: 'stale' (don't delete - audit trail)   │
│                                                                 │
│  3. Emit metrics: schemas_synced, schemas_stale, sync_duration  │
└─────────────────────────────────────────────────────────────────┘
```

**Activity Definitions:**

```go
// FetchSchemaSubjectsInput - input for listing subjects from Schema Registry
type FetchSchemaSubjectsInput struct {
    ClusterID         string
    SchemaRegistryURL string
    Username          string // optional basic auth
    Password          string // optional basic auth
}

type FetchSchemaSubjectsOutput struct {
    Subjects []string
}

// SyncSchemaVersionsInput - input for syncing all versions of a subject
type SyncSchemaVersionsInput struct {
    ClusterID         string
    SchemaRegistryURL string
    Subject           string
    VirtualClusterID  string // parsed from subject prefix
    TopicID           string // looked up from topic name
    SchemaType        string // "key" or "value"
}

type SyncSchemaVersionsOutput struct {
    VersionsSynced int
    LatestVersion  int
    SchemaID       int
}

// MarkStaleSchemasInput - input for marking schemas not seen in sync
type MarkStaleSchemasInput struct {
    ClusterID    string
    SyncedBefore time.Time // schemas not updated since this time are stale
}
```

---

### 2.2 ConsumerGroupSyncWorkflow

**Purpose:** Discover consumer groups from Kafka brokers and sync to Payload.

**Schedule:** Every 60 seconds (more frequent - groups are ephemeral)

**Task Queue:** `kafka-consumer-group-sync`

```
┌─────────────────────────────────────────────────────────────────┐
│                  ConsumerGroupSyncWorkflow                      │
├─────────────────────────────────────────────────────────────────┤
│  1. FetchClustersActivity                                       │
│     → Query Payload: all active KafkaClusters                   │
│                                                                 │
│  2. For each cluster (sequential):                              │
│     ├── ListConsumerGroupsActivity                              │
│     │   → Kafka Admin API: listConsumerGroups()                 │
│     │   → Filter by known virtual cluster prefixes              │
│     │                                                           │
│     ├── For each group (batched, 20 concurrent):                │
│     │   └── DescribeConsumerGroupActivity                       │
│     │       → describeConsumerGroups([groupId])                 │
│     │       → Parse prefix → identify virtual cluster           │
│     │       → Get: state, members, coordinator, subscribed topics
│     │       → Upsert to KafkaConsumerGroups                     │
│     │                                                           │
│     └── MarkInactiveGroupsActivity                              │
│         → Groups with lastSeen > 24h + state=Empty → inactive   │
│         → Groups with lastSeen > 7d → archived                  │
│                                                                 │
│  3. Emit metrics: groups_synced, groups_inactive, sync_duration │
└─────────────────────────────────────────────────────────────────┘
```

**Activity Definitions:**

```go
// ListConsumerGroupsInput - input for listing groups from Kafka
type ListConsumerGroupsInput struct {
    ClusterID        string
    BootstrapServers string
    SASLConfig       *SASLConfig // optional auth
}

type ListConsumerGroupsOutput struct {
    GroupIDs []string
}

// DescribeConsumerGroupInput - input for describing a single group
type DescribeConsumerGroupInput struct {
    ClusterID        string
    BootstrapServers string
    GroupID          string
    VirtualClusterID string // parsed from group prefix
}

type DescribeConsumerGroupOutput struct {
    GroupID            string
    State              string   // Stable, Rebalancing, Empty, Dead
    Members            int
    CoordinatorBroker  string
    AssignmentStrategy string
    SubscribedTopics   []string
}

// MarkInactiveGroupsInput - input for marking stale groups
type MarkInactiveGroupsInput struct {
    ClusterID        string
    InactiveThreshold time.Duration // 24h
    ArchiveThreshold  time.Duration // 7d
}
```

---

### 2.3 ConsumerLagCheckWorkflow

**Purpose:** Calculate and store consumer lag for active groups.

**Schedule:** Every 5 minutes

**Task Queue:** `kafka-consumer-lag`

```
┌─────────────────────────────────────────────────────────────────┐
│                   ConsumerLagCheckWorkflow                      │
├─────────────────────────────────────────────────────────────────┤
│  1. FetchActiveGroupsActivity                                   │
│     → Query Payload: KafkaConsumerGroups where status = 'active'│
│     → Group by cluster for efficient batching                   │
│                                                                 │
│  2. For each cluster (sequential):                              │
│     └── CalculateLagBatchActivity (all groups on cluster)       │
│         → For each group:                                       │
│           ├── listConsumerGroupOffsets(groupId)                 │
│           ├── For each subscribed topic-partition:              │
│           │   └── getEndOffsets([topicPartition])               │
│           ├── lag[partition] = endOffset - committedOffset      │
│           └── totalLag = sum(lag[*])                            │
│         → Batch update KafkaConsumerGroups                      │
│                                                                 │
│  3. StoreLagHistoryActivity                                     │
│     → Upsert to KafkaConsumerGroupLagHistory (for charting)     │
│                                                                 │
│  4. Emit metrics: total_lag, groups_with_lag, max_lag           │
└─────────────────────────────────────────────────────────────────┘
```

**Activity Definitions:**

```go
// FetchActiveGroupsInput - input for fetching groups to check
type FetchActiveGroupsInput struct{}

type FetchActiveGroupsOutput struct {
    GroupsByCluster map[string][]ConsumerGroupInfo // clusterID -> groups
}

type ConsumerGroupInfo struct {
    GroupID          string
    VirtualClusterID string
    SubscribedTopics []string
}

// CalculateLagBatchInput - input for calculating lag for multiple groups
type CalculateLagBatchInput struct {
    ClusterID        string
    BootstrapServers string
    Groups           []ConsumerGroupInfo
}

type CalculateLagBatchOutput struct {
    Results []ConsumerGroupLagResult
}

type ConsumerGroupLagResult struct {
    GroupID      string
    TotalLag     int64
    PartitionLag map[string]int64 // "topic-partition" -> lag
    Error        string           // if failed to calculate
}

// StoreLagHistoryInput - input for storing historical lag snapshots
type StoreLagHistoryInput struct {
    Snapshots []LagSnapshot
}

type LagSnapshot struct {
    ConsumerGroupID  string
    VirtualClusterID string
    WorkspaceID      string
    Timestamp        time.Time
    TotalLag         int64
    PartitionLag     map[string]int64
    MemberCount      int
    State            string
}
```

---

## 3. Payload Collections

### 3.1 New Collection: KafkaSchemaVersions

**Purpose:** Store all versions of a schema (KafkaSchemas stores latest only).

```typescript
// orbit-www/src/collections/kafka/KafkaSchemaVersions.ts

export const KafkaSchemaVersions: CollectionConfig = {
  slug: 'kafka-schema-versions',
  admin: {
    useAsTitle: 'version',
    group: 'Kafka',
    defaultColumns: ['schema', 'version', 'schemaId', 'registeredAt'],
    description: 'Historical versions of Kafka schemas',
  },
  access: {
    // Same access pattern as KafkaSchemas - workspace membership based
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: { user: { equals: user.id }, status: { equals: 'active' } },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return { workspace: { in: workspaceIds } }
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'schema',
      type: 'relationship',
      relationTo: 'kafka-schemas',
      required: true,
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'version',
      type: 'number',
      required: true,
      index: true,
    },
    {
      name: 'schemaId',
      type: 'number',
      required: true,
      admin: { description: 'Global Schema Registry ID' },
    },
    {
      name: 'content',
      type: 'code',
      required: true,
      admin: { language: 'json', description: 'Full schema definition' },
    },
    {
      name: 'fingerprint',
      type: 'text',
      index: true,
      admin: { description: 'Schema hash for deduplication' },
    },
    {
      name: 'compatibilityMode',
      type: 'select',
      options: [
        { label: 'Backward', value: 'backward' },
        { label: 'Forward', value: 'forward' },
        { label: 'Full', value: 'full' },
        { label: 'None', value: 'none' },
      ],
    },
    {
      name: 'isCompatible',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Was this version compatible when registered' },
    },
    {
      name: 'registeredAt',
      type: 'date',
      admin: { description: 'When registered in Schema Registry' },
    },
    {
      name: 'syncedAt',
      type: 'date',
      admin: { description: 'When synced to Orbit' },
    },
  ],
  indexes: [
    { fields: ['schema', 'version'], unique: true },
  ],
  timestamps: true,
}
```

---

### 3.2 New Collection: KafkaConsumerGroupLagHistory

**Purpose:** Time-series lag data for charting trends.

```typescript
// orbit-www/src/collections/kafka/KafkaConsumerGroupLagHistory.ts

export const KafkaConsumerGroupLagHistory: CollectionConfig = {
  slug: 'kafka-consumer-group-lag-history',
  admin: {
    useAsTitle: 'timestamp',
    group: 'Kafka',
    defaultColumns: ['consumerGroup', 'totalLag', 'memberCount', 'timestamp'],
    description: 'Historical lag snapshots for consumer groups',
  },
  access: {
    read: async ({ req: { user, payload } }) => {
      if (!user) return false
      if (user.collection === 'users') return true

      const memberships = await payload.find({
        collection: 'workspace-members',
        where: { user: { equals: user.id }, status: { equals: 'active' } },
        limit: 1000,
        overrideAccess: true,
      })

      const workspaceIds = memberships.docs.map(m =>
        String(typeof m.workspace === 'string' ? m.workspace : m.workspace.id)
      )

      return { workspace: { in: workspaceIds } }
    },
    create: ({ req: { user } }) => user?.collection === 'users',
    update: ({ req: { user } }) => user?.collection === 'users',
    delete: ({ req: { user } }) => user?.collection === 'users',
  },
  fields: [
    {
      name: 'consumerGroup',
      type: 'relationship',
      relationTo: 'kafka-consumer-groups',
      required: true,
      index: true,
    },
    {
      name: 'virtualCluster',
      type: 'relationship',
      relationTo: 'kafka-virtual-clusters',
      index: true,
    },
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      index: true,
    },
    {
      name: 'timestamp',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'totalLag',
      type: 'number',
      required: true,
    },
    {
      name: 'partitionLag',
      type: 'json',
      admin: { description: '{ "topic-0": 150, "topic-1": 42, ... }' },
    },
    {
      name: 'memberCount',
      type: 'number',
    },
    {
      name: 'state',
      type: 'text',
    },
  ],
  indexes: [
    { fields: ['consumerGroup', 'timestamp'] },
    { fields: ['virtualCluster', 'timestamp'] },
    { fields: ['workspace', 'timestamp'] },
  ],
  timestamps: true,
}
```

**Retention policy:** Implement via scheduled cleanup job:
- Keep 7 days of 5-minute snapshots (~2,016 records per group)
- Downsample to hourly for 30 days
- Downsample to daily for 1 year

---

### 3.3 Extensions to KafkaSchemas

```typescript
// Add to existing KafkaSchemas.ts fields array:

{
  name: 'latestVersion',
  type: 'number',
  admin: { description: 'Latest version number (cached)' },
},
{
  name: 'versionCount',
  type: 'number',
  admin: { description: 'Total versions registered' },
},
{
  name: 'firstRegisteredAt',
  type: 'date',
  admin: { description: 'When first version was registered' },
},
{
  name: 'lastRegisteredAt',
  type: 'date',
  admin: { description: 'When latest version was registered' },
},
// Update status options:
{
  name: 'status',
  type: 'select',
  required: true,
  defaultValue: 'pending',
  options: [
    { label: 'Pending', value: 'pending' },
    { label: 'Registered', value: 'registered' },
    { label: 'Failed', value: 'failed' },
    { label: 'Stale', value: 'stale' },  // NEW
  ],
},
```

---

### 3.4 Extensions to KafkaConsumerGroups

```typescript
// Add to existing KafkaConsumerGroups.ts fields array:

{
  name: 'subscribedTopics',
  type: 'relationship',
  relationTo: 'kafka-topics',
  hasMany: true,
  admin: { description: 'Topics this group consumes' },
},
{
  name: 'coordinatorBroker',
  type: 'text',
  admin: { description: 'Broker ID hosting coordinator' },
},
{
  name: 'assignmentStrategy',
  type: 'text',
  admin: { description: 'range, roundrobin, sticky, cooperative-sticky' },
},
{
  name: 'status',
  type: 'select',
  defaultValue: 'active',
  options: [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Archived', value: 'archived' },
  ],
  admin: { position: 'sidebar' },
},
```

---

## 4. UI Pages & Components

### 4.1 Page Structure

```
/kafka/                                    # Unified observability (permission-filtered)
├── layout.tsx                             # Layout with navigation
├── schemas/
│   ├── page.tsx                           # All schemas user can access
│   └── [schemaId]/
│       └── page.tsx                       # Schema detail with version history
├── consumer-groups/
│   ├── page.tsx                           # All groups user can access
│   └── [groupId]/
│       └── page.tsx                       # Group detail with lag chart

/{workspace}/kafka/                        # Workspace-scoped
├── schemas/
│   ├── page.tsx                           # Workspace schemas
│   └── [schemaId]/page.tsx
├── consumer-groups/
│   ├── page.tsx                           # Workspace groups
│   └── [groupId]/page.tsx

/{workspace}/kafka/applications/[appSlug]/[env]/  # Virtual cluster-scoped
├── schemas/page.tsx
├── consumer-groups/page.tsx
```

### 4.2 Permission Model

```typescript
// Server action pattern for permission-filtered queries

async function getAccessibleSchemas(filters: SchemaFilters) {
  const user = await getCurrentUser()

  // Platform admins see everything
  if (user.role === 'platform-admin') {
    return payload.find({
      collection: 'kafka-schemas',
      where: buildFilters(filters),
    })
  }

  // Regular users see schemas in their workspaces
  const memberships = await payload.find({
    collection: 'workspace-members',
    where: {
      user: { equals: user.id },
      status: { equals: 'active' },
    },
  })

  const workspaceIds = memberships.docs.map(m => m.workspace.id)

  return payload.find({
    collection: 'kafka-schemas',
    where: {
      and: [
        { workspace: { in: workspaceIds } },
        ...buildFilters(filters),
      ],
    },
  })
}
```

### 4.3 Schemas List Page

**Route:** `/kafka/schemas` (unified), `/{workspace}/kafka/schemas` (workspace)

**Features:**
- Full-text search on subject name and topic name
- Filter by: workspace (unified only), format (Avro/Protobuf/JSON), application, environment, status
- Sort by: subject, version count, last updated
- Summary bar: total schemas by format, workspace count

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  All Schemas                                                        │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Search...      │ Workspace ▼ │ App ▼ │ Format ▼ │ Env ▼ │ Status ▼│
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─ Summary ───────────────────────────────────────────────────────┐│
│  │  Total: 156 schemas │ Avro: 89 │ Proto: 45 │ JSON: 22           ││
│  │  Across 8 workspaces, 24 applications                           ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Subject        │ Workspace │ App      │ Topic  │ Format │ Ver   ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ orders-value   │ acme-corp │ payments │ orders │ Avro   │ 3     ││
│  │ users-value    │ acme-corp │ identity │ users  │ Proto  │ 12    ││
│  │ events-value   │ beta-inc  │ analytics│ events │ JSON   │ 1     ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Showing 1-10 of 156                                  < 1 2 3 ... > │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.4 Schema Detail Page

**Route:** `/kafka/schemas/[schemaId]`

**Features:**
- Version timeline visualization
- Toggle between versions to view schema content
- Side-by-side diff view (compare any two versions)
- Copy/download schema definition
- Metadata: compatibility mode, schema ID, registration timestamp

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Schemas                                                  │
│                                                                     │
│  orders-value                                          [Avro] [v3]  │
│  Topic: orders • App: payments-service • Env: prod                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Version History ───────────────────────────────────────────────┐│
│  │                                                                 ││
│  │  v3 (current)  ●────────────────────────────────────────────●   ││
│  │  Jan 8, 2026   │  Added 'currency' field                        ││
│  │                │                                                ││
│  │  v2            ●────────────────────────────────────────────●   ││
│  │  Jan 5, 2026   │  Added 'amount' field                          ││
│  │                │                                                ││
│  │  v1            ●────────────────────────────────────────────●   ││
│  │  Jan 1, 2026   │  Initial schema                                ││
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Schema Definition ─────────────────────────────────────────────┐│
│  │  Version: [v1] [v2] [v3]                      [Copy] [Download] ││
│  │  ┌───────────────────────────────────────────────────────────┐  ││
│  │  │ {                                                         │  ││
│  │  │   "type": "record",                                       │  ││
│  │  │   "name": "Order",                                        │  ││
│  │  │   "fields": [                                             │  ││
│  │  │     {"name": "id", "type": "string"},                     │  ││
│  │  │     {"name": "amount", "type": "double"},                 │  ││
│  │  │     {"name": "currency", "type": "string"}                │  ││
│  │  │   ]                                                       │  ││
│  │  │ }                                                         │  ││
│  │  └───────────────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Compare Versions ──────────────────────────────────────────────┐│
│  │  [v2 ▼] compared to [v3 ▼]                         [View Diff]  ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Metadata ──────────────────────────────────────────────────────┐│
│  │  Compatibility: BACKWARD    Subject: prod.acme.orders-value     ││
│  │  Schema ID: 42              Registered: Jan 8, 2026 at 2:30 PM  ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 4.5 Consumer Groups List Page

**Route:** `/kafka/consumer-groups` (unified), `/{workspace}/kafka/consumer-groups` (workspace)

**Features:**
- Summary bar: group counts by state, total lag
- Full-text search on group ID
- Filter by: workspace (unified only), state, application, environment, has-lag
- Sort by: group ID, member count, total lag
- Trend indicator: lag direction over last hour

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  All Consumer Groups                                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Search...      │ Workspace ▼ │ App ▼ │ State ▼ │ Env ▼ │ Lag ▼  │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─ Aggregate Overview ────────────────────────────────────────────┐│
│  │  Groups: 47 total │ Stable: 38 │ Rebalancing: 3 │ Empty: 6      ││
│  │  Total Lag: 234,567 │ Avg Lag: 4,991 │ Groups with lag: 23      ││
│  │  Across 8 workspaces, 24 applications                           ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Group ID       │ Workspace │ App       │ State   │ Lag    │Trend││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ order-proc     │ acme-corp │ payments  │ ●Stable │ 1,234  │ ↗   ││
│  │ user-sync      │ acme-corp │ identity  │ ●Stable │ 56     │ →   ││
│  │ event-agg      │ beta-inc  │ analytics │ ○Rebal  │ 45,000 │ ↗↗  ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Showing 1-10 of 47                                   < 1 2 3 ... > │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.6 Consumer Group Detail Page

**Route:** `/kafka/consumer-groups/[groupId]`

**Features:**
- Lag time-series chart with time range selector (1h, 6h, 24h, 7d)
- Per-partition lag breakdown with owner assignment
- Member list with client metadata
- Group metadata: coordinator, assignment strategy, last rebalance time

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Consumer Groups                                          │
│                                                                     │
│  order-processor                              [●Stable] [3 members] │
│  App: payments-service • Env: prod • Coordinator: broker-2          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Lag Over Time ─────────────────────────────────────────────────┐│
│  │  [1h] [6h] [24h] [7d]                                           ││
│  │                                                                 ││
│  │  1500 │                                    ╭─╮                  ││
│  │       │                              ╭────╯  ╰──╮               ││
│  │  1000 │        ╭──────╮         ╭───╯          ╰──╮             ││
│  │       │   ╭───╯      ╰────────╯                   ╰───          ││
│  │   500 │──╯                                                      ││
│  │       │                                                         ││
│  │     0 └─────────────────────────────────────────────────────    ││
│  │         10:00    11:00    12:00    13:00    14:00    15:00      ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Partition Lag ─────────────────────────────────────────────────┐│
│  │  Topic: orders                                                  ││
│  │  ┌─────────────────────────────────────────────────────────┐    ││
│  │  │ Partition │ Current Offset │ End Offset │ Lag   │ Owner │    ││
│  │  ├─────────────────────────────────────────────────────────┤    ││
│  │  │ 0         │ 152,340        │ 152,490    │ 150   │ member-1│  ││
│  │  │ 1         │ 148,200        │ 148,242    │ 42    │ member-2│  ││
│  │  │ 2         │ 155,000        │ 155,000    │ 0     │ member-3│  ││
│  │  └─────────────────────────────────────────────────────────┘    ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ Members ───────────────────────────────────────────────────────┐│
│  │  Member ID       │ Client ID      │ Host          │ Partitions  ││
│  │  member-1-abc123 │ order-proc-1   │ 10.0.1.15     │ 0           ││
│  │  member-2-def456 │ order-proc-2   │ 10.0.1.16     │ 1           ││
│  │  member-3-ghi789 │ order-proc-3   │ 10.0.1.17     │ 2           ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 4.7 Component Reuse Strategy

**Shared components** with props-based scope configuration:

| Component | Unified | Workspace | Virtual Cluster |
|-----------|---------|-----------|-----------------|
| `SchemaTable` | workspace column visible | workspace hidden | app/env hidden |
| `ConsumerGroupTable` | workspace column visible | workspace hidden | app/env hidden |
| `SchemaDetail` | same | same | same |
| `ConsumerGroupDetail` | same | same | same |
| `LagChart` | same | same | same |
| `FilterBar` | all filters | no workspace filter | minimal filters |

```typescript
interface SchemaTableProps {
  scope: 'unified' | 'workspace' | 'virtual-cluster'
  workspaceId?: string      // pre-filter if workspace/vc scope
  virtualClusterId?: string // pre-filter if vc scope
}

interface ConsumerGroupTableProps {
  scope: 'unified' | 'workspace' | 'virtual-cluster'
  workspaceId?: string
  virtualClusterId?: string
}
```

---

## 5. Implementation Plan

### 5.1 New Files to Create

**Temporal Workflows & Activities:**
```
temporal-workflows/internal/
├── workflows/
│   ├── kafka_schema_sync_workflow.go
│   ├── kafka_consumer_group_sync_workflow.go
│   └── kafka_consumer_lag_workflow.go
├── activities/
│   ├── kafka_schema_activities.go
│   └── kafka_consumer_group_activities.go
```

**Payload Collections:**
```
orbit-www/src/collections/kafka/
├── KafkaSchemaVersions.ts
├── KafkaConsumerGroupLagHistory.ts
```

**Server Actions:**
```
orbit-www/src/app/actions/
├── kafka-schemas.ts
├── kafka-consumer-groups.ts
```

**UI Pages - Unified:**
```
orbit-www/src/app/(frontend)/kafka/
├── layout.tsx
├── schemas/
│   ├── page.tsx
│   └── [schemaId]/page.tsx
├── consumer-groups/
│   ├── page.tsx
│   └── [groupId]/page.tsx
```

**UI Pages - Workspace-scoped:**
```
orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/
├── schemas/
│   ├── page.tsx
│   └── [schemaId]/page.tsx
├── consumer-groups/
│   ├── page.tsx
│   └── [groupId]/page.tsx
```

**UI Pages - Virtual Cluster-scoped:**
```
orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/applications/[appSlug]/[env]/
├── schemas/page.tsx
├── consumer-groups/page.tsx
```

**Shared Components:**
```
orbit-www/src/components/features/kafka/
├── SchemaTable.tsx
├── SchemaVersionTimeline.tsx
├── SchemaVersionDiff.tsx
├── ConsumerGroupTable.tsx
├── ConsumerGroupLagChart.tsx
├── PartitionLagTable.tsx
├── ConsumerGroupMembersTable.tsx
├── FilterBar.tsx
├── ScopedKafkaNav.tsx
```

### 5.2 Files to Modify

```
orbit-www/src/collections/kafka/KafkaSchemas.ts          # Add new fields
orbit-www/src/collections/kafka/KafkaConsumerGroups.ts   # Add new fields
orbit-www/src/payload.config.ts                          # Register new collections
orbit-www/src/components/features/kafka/KafkaNavigation.tsx  # Add new links
temporal-workflows/cmd/worker/main.go                    # Register new workflows
```

### 5.3 Task Breakdown

| # | Task | Files | Size |
|---|------|-------|------|
| **Data Layer** |
| 1 | Create KafkaSchemaVersions collection | KafkaSchemaVersions.ts, payload.config.ts | S |
| 2 | Create KafkaConsumerGroupLagHistory collection | KafkaConsumerGroupLagHistory.ts, payload.config.ts | S |
| 3 | Extend KafkaSchemas collection | KafkaSchemas.ts | S |
| 4 | Extend KafkaConsumerGroups collection | KafkaConsumerGroups.ts | S |
| **Temporal Workflows** |
| 5 | Implement SchemaSyncWorkflow + activities | kafka_schema_sync_workflow.go, kafka_schema_activities.go | M |
| 6 | Implement ConsumerGroupSyncWorkflow + activities | kafka_consumer_group_sync_workflow.go, kafka_consumer_group_activities.go | M |
| 7 | Implement ConsumerLagCheckWorkflow + activities | kafka_consumer_lag_workflow.go, kafka_consumer_group_activities.go | M |
| 8 | Register workflows with worker | worker/main.go | S |
| **Server Actions** |
| 9 | Create kafka-schemas server actions | kafka-schemas.ts | M |
| 10 | Create kafka-consumer-groups server actions | kafka-consumer-groups.ts | M |
| **Shared Components** |
| 11 | Build SchemaTable component | SchemaTable.tsx | M |
| 12 | Build SchemaVersionTimeline component | SchemaVersionTimeline.tsx | M |
| 13 | Build SchemaVersionDiff component | SchemaVersionDiff.tsx | M |
| 14 | Build ConsumerGroupTable component | ConsumerGroupTable.tsx | M |
| 15 | Build ConsumerGroupLagChart component | ConsumerGroupLagChart.tsx | L |
| 16 | Build PartitionLagTable component | PartitionLagTable.tsx | S |
| 17 | Build ConsumerGroupMembersTable component | ConsumerGroupMembersTable.tsx | S |
| 18 | Build FilterBar component | FilterBar.tsx | M |
| **Unified Pages** |
| 19 | Build /kafka layout | kafka/layout.tsx | S |
| 20 | Build /kafka/schemas page | kafka/schemas/page.tsx | M |
| 21 | Build /kafka/schemas/[schemaId] page | kafka/schemas/[schemaId]/page.tsx | M |
| 22 | Build /kafka/consumer-groups page | kafka/consumer-groups/page.tsx | M |
| 23 | Build /kafka/consumer-groups/[groupId] page | kafka/consumer-groups/[groupId]/page.tsx | M |
| **Workspace Pages** |
| 24 | Build workspace schemas pages | workspaces/[slug]/kafka/schemas/*.tsx | S |
| 25 | Build workspace consumer-groups pages | workspaces/[slug]/kafka/consumer-groups/*.tsx | S |
| **Virtual Cluster Pages** |
| 26 | Build VC schemas page | .../[appSlug]/[env]/schemas/page.tsx | S |
| 27 | Build VC consumer-groups page | .../[appSlug]/[env]/consumer-groups/page.tsx | S |
| **Navigation & Polish** |
| 28 | Update KafkaNavigation with new links | KafkaNavigation.tsx | S |

**Size key:** S = Small (< 100 lines), M = Medium (100-300 lines), L = Large (300+ lines)

---

## 6. Future Enhancements (Post-MVP)

### 6.1 Push-based Real-time Updates
- Add Bifrost callbacks for schema registration and consumer group joins
- Extend `BifrostCallbackService` proto with `SchemaRegistered`, `ConsumerGroupJoined` RPCs
- Keep pull-based sync as reconciliation backup

### 6.2 Schema Registry Subject Rewriting (Task 7.1)
- Implement Bifrost filter for Schema Registry HTTP passthrough
- Rewrite subjects: `orders-value` → `{env}.{workspace}.orders-value`
- Enable self-service schema registration through Bifrost

### 6.3 JoinGroup Interception (Task 7.4)
- Implement Bifrost filter for real-time consumer group tracking
- Emit events on group join/leave for immediate UI updates
- Track member-to-partition assignments in real-time

### 6.4 Alerting Integration
- Lag threshold alerts per consumer group
- Schema compatibility failure notifications
- Integration with PagerDuty/Slack/email

---

## 7. Key Decisions Summary

| Area | Decision |
|------|----------|
| **Sync Strategy** | Pull-based with Temporal workflows (MVP), push-based later |
| **Workflow Pattern** | Global singleton, sequential cluster iteration |
| **Schema Versioning** | Separate KafkaSchemaVersions collection for history |
| **Lag History** | KafkaConsumerGroupLagHistory with 7d/30d/1y retention tiers |
| **UI Scope** | Full-featured: unified + workspace + virtual cluster pages |
| **Permission Model** | Workspace membership filtering, platform admins see all |
| **Component Reuse** | Props-based scope configuration for tables/filters |
