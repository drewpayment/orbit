# Bifrost Phase 6: Metrics & Chargeback Design

**Status:** DRAFT
**Date:** 2026-01-08
**Authors:** Platform Engineering

## Overview

Phase 6 implements usage tracking and cost visibility for the Bifrost Kafka Gateway. This enables workspace teams to understand their Kafka consumption patterns and provides platform admins with chargeback data for billing purposes.

### Goals

- Capture per-request metrics at the gateway level
- Aggregate metrics hourly for efficient storage and querying
- Calculate costs based on system-wide chargeback rates
- Provide application-level usage dashboards for workspace members
- Provide platform-wide chargeback dashboard for admins
- Enable CSV export for billing integration

### Non-Goals (MVP)

- Real-time alerting on usage thresholds
- Per-workspace custom pricing tiers
- Minute-level granularity for historical data
- Automated billing system integration (API push)

---

## Architecture

### Data Flow

```
Bifrost Gateway (Kotlin)
    │
    ├─ Micrometer metrics library
    ├─ Counters: bytes_in, bytes_out, messages per (vcluster, topic, service_account, direction)
    └─ Exposes /metrics endpoint (Prometheus format) on port 9093
          │
          ▼
Prometheus (Docker Compose)
    │
    ├─ Scrapes Bifrost every 15s
    ├─ Stores raw metrics with 15-day retention
    └─ Available for ad-hoc queries and alerting (future)
          │
          ▼
Temporal: UsageMetricsRollupWorkflow (every 5 min)
    │
    ├─ Queries Prometheus for delta since last run
    ├─ Aggregates to hourly buckets by (vcluster, topic, service_account)
    └─ Stores to KafkaUsageMetrics collection via Payload API
          │
          ▼
KafkaUsageMetrics (Payload CMS)
    │
    ├─ Hourly granularity records
    ├─ Relationships: application, virtualCluster, topic, serviceAccount
    └─ Source for dashboards and chargeback calculation
          │
          ▼
Chargeback Calculation (TypeScript)
    │
    ├─ Reads KafkaUsageMetrics for period
    ├─ Applies system-wide rates from KafkaChargebackRates
    └─ Aggregates to application level for export
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Metrics backend | Prometheus (pull model) | Industry standard, enables observability beyond billing |
| Storage granularity | Hourly | Sufficient for monthly billing, manageable storage |
| Chargeback rates | System-wide only | Simple, fair, auditable; per-workspace overrides can be added later |
| Metrics dimensions | vCluster + topic + serviceAccount | Enough detail to identify cost drivers and attribute to consumers |
| Export format | CSV summary by application | Clean for finance, topic detail available in UI |
| Dashboard focus | Current month | Actionable, fast queries; historical via month picker |

---

## Prometheus Infrastructure

### Docker Compose Addition

Add to `docker-compose.yml`:

```yaml
prometheus:
  image: prom/prometheus:v2.47.0
  container_name: orbit-prometheus
  ports:
    - "9090:9090"
  volumes:
    - ./infrastructure/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
    - prometheus-data:/prometheus
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--storage.tsdb.retention.time=15d'
  networks:
    - orbit-network
```

Add volume:

```yaml
volumes:
  prometheus-data:
```

### Scrape Configuration

New file `infrastructure/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'bifrost-dev'
    static_configs:
      - targets: ['bifrost-dev:9093']
    metrics_path: /metrics

  - job_name: 'bifrost-stage'
    static_configs:
      - targets: ['bifrost-stage:9093']
    metrics_path: /metrics

  - job_name: 'bifrost-prod'
    static_configs:
      - targets: ['bifrost-prod:9093']
    metrics_path: /metrics
```

For local development, only `bifrost-dev` will be running. The config includes all environments for production parity.

---

## Bifrost Metrics Instrumentation

### Dependencies

Add to `gateway/bifrost/build.gradle.kts`:

```kotlin
implementation("io.micrometer:micrometer-registry-prometheus:1.12.0")
```

### Metrics Exposed

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `bifrost_bytes_total` | Counter | `virtual_cluster`, `topic`, `service_account`, `direction` | Total bytes transferred |
| `bifrost_messages_total` | Counter | `virtual_cluster`, `topic`, `service_account`, `direction` | Total message count |
| `bifrost_requests_total` | Counter | `virtual_cluster`, `operation` | Request count by Kafka operation |
| `bifrost_active_connections` | Gauge | `virtual_cluster` | Current connection count |
| `bifrost_request_latency_seconds` | Histogram | `virtual_cluster`, `operation` | Request latency distribution |

### Label Values

- `direction`: `produce` or `consume`
- `operation`: `Produce`, `Fetch`, `Metadata`, `CreateTopics`, `DeleteTopics`, `JoinGroup`, etc.

### Instrumentation Points

Metrics captured in the Kroxylicious filter chain:

1. **ProduceRequest filter**: Increment `bytes_total` and `messages_total` with `direction=produce`
2. **FetchResponse filter**: Increment `bytes_total` and `messages_total` with `direction=consume`
3. **All requests**: Increment `requests_total`, record latency in histogram

### Admin Endpoint

Bifrost exposes `/metrics` on admin port `9093` (separate from Kafka protocol port 9092).

```kotlin
// MetricsEndpoint.kt
@Component
class MetricsEndpoint(private val registry: PrometheusMeterRegistry) {

    fun start() {
        val server = embeddedServer(Netty, port = 9093) {
            routing {
                get("/metrics") {
                    call.respondText(registry.scrape(), ContentType.Text.Plain)
                }
                get("/health") {
                    call.respondText("OK")
                }
            }
        }
        server.start(wait = false)
    }
}
```

---

## Temporal Workflow: UsageMetricsRollupWorkflow

### Workflow Definition

Location: `temporal-workflows/internal/workflows/metrics_rollup_workflow.go`

```go
package workflows

import (
    "time"
    "go.temporal.io/sdk/workflow"
)

// UsageMetricsRollupWorkflow aggregates Bifrost metrics to hourly buckets
// Schedule: Every 5 minutes via Temporal schedule
// Idempotency: Uses hour bucket + dimensions as dedup key
func UsageMetricsRollupWorkflow(ctx workflow.Context) error {
    logger := workflow.GetLogger(ctx)

    ao := workflow.ActivityOptions{
        StartToCloseTimeout: 2 * time.Minute,
        RetryPolicy: &temporal.RetryPolicy{
            MaximumAttempts: 3,
        },
    }
    ctx = workflow.WithActivityOptions(ctx, ao)

    // 1. Get last checkpoint
    var checkpoint time.Time
    err := workflow.ExecuteActivity(ctx, GetLastCheckpoint).Get(ctx, &checkpoint)
    if err != nil {
        // First run - start from 1 hour ago
        checkpoint = workflow.Now(ctx).Add(-1 * time.Hour).Truncate(time.Hour)
    }

    // 2. Query Prometheus for metrics since checkpoint
    var metrics []RawMetric
    err = workflow.ExecuteActivity(ctx, QueryPrometheusMetrics, checkpoint).Get(ctx, &metrics)
    if err != nil {
        return err
    }

    if len(metrics) == 0 {
        logger.Info("No new metrics to process")
        return nil
    }

    // 3. Aggregate to hourly buckets
    var aggregated []HourlyMetric
    err = workflow.ExecuteActivity(ctx, AggregateToHourlyBuckets, metrics).Get(ctx, &aggregated)
    if err != nil {
        return err
    }

    // 4. Upsert to KafkaUsageMetrics
    err = workflow.ExecuteActivity(ctx, UpsertUsageMetrics, aggregated).Get(ctx, &struct{}{})
    if err != nil {
        return err
    }

    // 5. Save checkpoint
    newCheckpoint := workflow.Now(ctx)
    err = workflow.ExecuteActivity(ctx, SaveCheckpoint, newCheckpoint).Get(ctx, &struct{}{})
    if err != nil {
        return err
    }

    logger.Info("Metrics rollup complete", "records", len(aggregated))
    return nil
}
```

### Activities

Location: `temporal-workflows/internal/activities/metrics_activities.go`

| Activity | Purpose |
|----------|---------|
| `GetLastCheckpoint` | Read last successful rollup timestamp from state store |
| `QueryPrometheusMetrics` | Fetch `bifrost_bytes_total` and `bifrost_messages_total` for time range |
| `AggregateToHourlyBuckets` | Group metrics by hour + dimensions, calculate deltas |
| `UpsertUsageMetrics` | Call Payload API to create/update `KafkaUsageMetrics` records |
| `SaveCheckpoint` | Persist checkpoint timestamp for next run |

### Prometheus Query

```promql
# Bytes produced per virtual cluster/topic/account in time range
increase(bifrost_bytes_total{direction="produce"}[5m])

# Bytes consumed per virtual cluster/topic/account in time range
increase(bifrost_bytes_total{direction="consume"}[5m])

# Messages produced
increase(bifrost_messages_total{direction="produce"}[5m])

# Messages consumed
increase(bifrost_messages_total{direction="consume"}[5m])
```

### Idempotency

Each `KafkaUsageMetrics` record is uniquely keyed by:
- `virtualCluster` + `topic` + `serviceAccount` + `hourBucket`

Upsert logic: If record exists for that composite key, add to existing totals. Otherwise create new record.

### Schedule Registration

```go
// In worker main.go
schedule, err := client.ScheduleClient().Create(ctx, client.ScheduleOptions{
    ID: "usage-metrics-rollup",
    Spec: client.ScheduleSpec{
        Intervals: []client.ScheduleIntervalSpec{
            {Every: 5 * time.Minute},
        },
    },
    Action: &client.ScheduleWorkflowAction{
        Workflow: workflows.UsageMetricsRollupWorkflow,
        TaskQueue: "bifrost-metrics",
    },
    Overlap: enums.SCHEDULE_OVERLAP_POLICY_SKIP,
})
```

---

## Data Model

### Extend KafkaUsageMetrics Collection

Location: `orbit-www/src/collections/kafka/KafkaUsageMetrics.ts`

Add fields:

```typescript
{
  name: 'application',
  type: 'relationship',
  relationTo: 'kafka-applications',
  required: true,
  index: true,
},
{
  name: 'virtualCluster',
  type: 'relationship',
  relationTo: 'kafka-virtual-clusters',
  required: true,
  index: true,
},
{
  name: 'serviceAccount',
  type: 'relationship',
  relationTo: 'kafka-service-accounts',
  index: true,  // Optional - may be null for pre-aggregated records
},
{
  name: 'hourBucket',
  type: 'date',
  required: true,
  index: true,
  admin: {
    description: 'Start of the hour this record represents (UTC)',
  },
},
```

Update existing fields to use clearer naming:

```typescript
{
  name: 'bytesIn',
  type: 'number',
  required: true,
  defaultValue: 0,
  admin: { description: 'Bytes produced (ingress)' },
},
{
  name: 'bytesOut',
  type: 'number',
  required: true,
  defaultValue: 0,
  admin: { description: 'Bytes consumed (egress)' },
},
{
  name: 'messagesIn',
  type: 'number',
  required: true,
  defaultValue: 0,
  admin: { description: 'Messages produced' },
},
{
  name: 'messagesOut',
  type: 'number',
  required: true,
  defaultValue: 0,
  admin: { description: 'Messages consumed' },
},
```

### New Collection: KafkaChargebackRates

Location: `orbit-www/src/collections/kafka/KafkaChargebackRates.ts`

```typescript
import { CollectionConfig } from 'payload'
import { platformAdminAccess } from '@/access/platformAdmin'

export const KafkaChargebackRates: CollectionConfig = {
  slug: 'kafka-chargeback-rates',
  admin: {
    group: 'Kafka',
    useAsTitle: 'effectiveDate',
    description: 'System-wide chargeback rates for Kafka usage billing',
  },
  access: {
    read: platformAdminAccess,
    create: platformAdminAccess,
    update: platformAdminAccess,
    delete: platformAdminAccess,
  },
  fields: [
    {
      name: 'costPerGBIn',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per GB of ingress (produce) traffic. Example: 0.10 = $0.10/GB',
        step: 0.01,
      },
    },
    {
      name: 'costPerGBOut',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per GB of egress (consume) traffic. Example: 0.05 = $0.05/GB',
        step: 0.01,
      },
    },
    {
      name: 'costPerMillionMessages',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Cost per million messages. Example: 0.01 = $0.01/million',
        step: 0.001,
      },
    },
    {
      name: 'effectiveDate',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description: 'Date from which these rates apply. Most recent rate before billing period start is used.',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'Internal notes about this rate change',
      },
    },
  ],
  timestamps: true,
}
```

### Rate Lookup Logic

When calculating charges for a billing period:

```typescript
// Find most recent rate effective before or on period start
const rate = await payload.find({
  collection: 'kafka-chargeback-rates',
  where: {
    effectiveDate: { less_than_equal: periodStart },
  },
  sort: '-effectiveDate',
  limit: 1,
})
```

---

## Chargeback Calculation Service

Location: `orbit-www/src/lib/billing/chargeback.ts`

### Types

```typescript
export interface ChargebackInput {
  workspaceId?: string       // Filter by workspace (optional for platform view)
  applicationId?: string     // Filter by application (optional)
  periodStart: Date          // Billing period start (inclusive)
  periodEnd: Date            // Billing period end (exclusive)
}

export interface ChargebackLineItem {
  workspaceId: string
  workspaceName: string
  applicationId: string
  applicationName: string
  ingressGB: number          // Total GB produced
  egressGB: number           // Total GB consumed
  messageCount: number       // Total messages (in + out)
  ingressCost: number        // ingressGB × costPerGBIn
  egressCost: number         // egressGB × costPerGBOut
  messageCost: number        // (messageCount / 1_000_000) × costPerMillionMessages
  totalCost: number          // Sum of all costs
}

export interface ChargebackSummary {
  periodStart: Date
  periodEnd: Date
  rates: {
    costPerGBIn: number
    costPerGBOut: number
    costPerMillionMessages: number
    effectiveDate: Date
  }
  lineItems: ChargebackLineItem[]
  totalIngressGB: number
  totalEgressGB: number
  totalMessages: number
  totalCost: number
}
```

### Core Function

```typescript
import { getPayload } from 'payload'
import config from '@payload-config'

const BYTES_PER_GB = 1024 * 1024 * 1024

export async function calculateChargeback(
  input: ChargebackInput
): Promise<ChargebackSummary> {
  const payload = await getPayload({ config })

  // 1. Fetch applicable rate
  const rateResult = await payload.find({
    collection: 'kafka-chargeback-rates',
    where: {
      effectiveDate: { less_than_equal: input.periodStart },
    },
    sort: '-effectiveDate',
    limit: 1,
  })

  if (rateResult.docs.length === 0) {
    throw new Error('No chargeback rate configured for this period')
  }

  const rate = rateResult.docs[0]

  // 2. Build query filters
  const where: Record<string, unknown> = {
    hourBucket: {
      greater_than_equal: input.periodStart,
      less_than: input.periodEnd,
    },
  }

  if (input.workspaceId) {
    where['application.workspace'] = { equals: input.workspaceId }
  }

  if (input.applicationId) {
    where.application = { equals: input.applicationId }
  }

  // 3. Query metrics grouped by application
  const metrics = await payload.find({
    collection: 'kafka-usage-metrics',
    where,
    limit: 10000, // Paginate for larger datasets
    depth: 2, // Include application and workspace
  })

  // 4. Aggregate by application
  const byApp = new Map<string, {
    workspaceId: string
    workspaceName: string
    applicationId: string
    applicationName: string
    bytesIn: number
    bytesOut: number
    messagesIn: number
    messagesOut: number
  }>()

  for (const metric of metrics.docs) {
    const app = metric.application as { id: string; name: string; workspace: { id: string; name: string } }
    const key = app.id

    const existing = byApp.get(key) || {
      workspaceId: app.workspace.id,
      workspaceName: app.workspace.name,
      applicationId: app.id,
      applicationName: app.name,
      bytesIn: 0,
      bytesOut: 0,
      messagesIn: 0,
      messagesOut: 0,
    }

    existing.bytesIn += metric.bytesIn || 0
    existing.bytesOut += metric.bytesOut || 0
    existing.messagesIn += metric.messagesIn || 0
    existing.messagesOut += metric.messagesOut || 0

    byApp.set(key, existing)
  }

  // 5. Calculate costs
  const lineItems: ChargebackLineItem[] = []
  let totalIngressGB = 0
  let totalEgressGB = 0
  let totalMessages = 0
  let totalCost = 0

  for (const agg of byApp.values()) {
    const ingressGB = agg.bytesIn / BYTES_PER_GB
    const egressGB = agg.bytesOut / BYTES_PER_GB
    const messageCount = agg.messagesIn + agg.messagesOut

    const ingressCost = ingressGB * rate.costPerGBIn
    const egressCost = egressGB * rate.costPerGBOut
    const messageCost = (messageCount / 1_000_000) * rate.costPerMillionMessages
    const itemTotal = ingressCost + egressCost + messageCost

    lineItems.push({
      workspaceId: agg.workspaceId,
      workspaceName: agg.workspaceName,
      applicationId: agg.applicationId,
      applicationName: agg.applicationName,
      ingressGB,
      egressGB,
      messageCount,
      ingressCost,
      egressCost,
      messageCost,
      totalCost: itemTotal,
    })

    totalIngressGB += ingressGB
    totalEgressGB += egressGB
    totalMessages += messageCount
    totalCost += itemTotal
  }

  // Sort by total cost descending
  lineItems.sort((a, b) => b.totalCost - a.totalCost)

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    rates: {
      costPerGBIn: rate.costPerGBIn,
      costPerGBOut: rate.costPerGBOut,
      costPerMillionMessages: rate.costPerMillionMessages,
      effectiveDate: rate.effectiveDate,
    },
    lineItems,
    totalIngressGB,
    totalEgressGB,
    totalMessages,
    totalCost,
  }
}
```

---

## CSV Export

### Workspace Export Action

Location: `orbit-www/src/app/(frontend)/[workspace]/kafka/billing/actions.ts`

```typescript
'use server'

import { calculateChargeback } from '@/lib/billing/chargeback'
import { format } from 'date-fns'

export async function exportWorkspaceChargebackCSV(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{ filename: string; content: string }> {
  const summary = await calculateChargeback({
    workspaceId,
    periodStart,
    periodEnd,
  })

  const headers = [
    'Workspace',
    'Application',
    'Ingress (GB)',
    'Egress (GB)',
    'Messages',
    'Ingress Cost',
    'Egress Cost',
    'Message Cost',
    'Total Cost',
  ]

  const rows = summary.lineItems.map(item => [
    item.workspaceName,
    item.applicationName,
    item.ingressGB.toFixed(2),
    item.egressGB.toFixed(2),
    item.messageCount.toString(),
    `$${item.ingressCost.toFixed(2)}`,
    `$${item.egressCost.toFixed(2)}`,
    `$${item.messageCost.toFixed(2)}`,
    `$${item.totalCost.toFixed(2)}`,
  ])

  // Add totals row
  rows.push([
    'TOTAL',
    '',
    summary.totalIngressGB.toFixed(2),
    summary.totalEgressGB.toFixed(2),
    summary.totalMessages.toString(),
    '',
    '',
    '',
    `$${summary.totalCost.toFixed(2)}`,
  ])

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')

  const startStr = format(periodStart, 'yyyy-MM-dd')
  const endStr = format(periodEnd, 'yyyy-MM-dd')
  const filename = `kafka-chargeback-${workspaceId}-${startStr}-to-${endStr}.csv`

  return { filename, content: csv }
}
```

### Platform Export Action

Location: `orbit-www/src/app/(frontend)/platform/kafka/billing/actions.ts`

```typescript
'use server'

import { calculateChargeback } from '@/lib/billing/chargeback'
import { format } from 'date-fns'

export async function exportPlatformChargebackCSV(
  periodStart: Date,
  periodEnd: Date
): Promise<{ filename: string; content: string }> {
  // No workspace filter - get all workspaces
  const summary = await calculateChargeback({
    periodStart,
    periodEnd,
  })

  const headers = [
    'Workspace',
    'Application',
    'Ingress (GB)',
    'Egress (GB)',
    'Messages',
    'Ingress Cost',
    'Egress Cost',
    'Message Cost',
    'Total Cost',
  ]

  const rows = summary.lineItems.map(item => [
    item.workspaceName,
    item.applicationName,
    item.ingressGB.toFixed(2),
    item.egressGB.toFixed(2),
    item.messageCount.toString(),
    `$${item.ingressCost.toFixed(2)}`,
    `$${item.egressCost.toFixed(2)}`,
    `$${item.messageCost.toFixed(2)}`,
    `$${item.totalCost.toFixed(2)}`,
  ])

  rows.push([
    'TOTAL',
    '',
    summary.totalIngressGB.toFixed(2),
    summary.totalEgressGB.toFixed(2),
    summary.totalMessages.toString(),
    '',
    '',
    '',
    `$${summary.totalCost.toFixed(2)}`,
  ])

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')

  const startStr = format(periodStart, 'yyyy-MM-dd')
  const endStr = format(periodEnd, 'yyyy-MM-dd')
  const filename = `kafka-chargeback-platform-${startStr}-to-${endStr}.csv`

  return { filename, content: csv }
}
```

---

## UI Components

### Application Usage Dashboard

Location: `orbit-www/src/app/(frontend)/[workspace]/kafka/applications/[appSlug]/usage/page.tsx`

**Layout**

```
┌─────────────────────────────────────────────────────────────────┐
│  Usage - payments-service                     January 2026  ▼   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Ingress     │  │  Egress      │  │  Messages    │          │
│  │  124.5 GB    │  │  89.2 GB     │  │  45.2M       │          │
│  │  $12.45      │  │  $4.46       │  │  $0.45       │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  Estimated Total: $17.36                                        │
├─────────────────────────────────────────────────────────────────┤
│  Daily Usage Trend                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ▄▄  ▄▄▄ ▄▄▄▄▄▄▄▄▄▄▄ ▄▄▄▄▄ ▄▄▄▄▄▄                      │   │
│  │  ██  ███ ███████████ █████ ██████  ← Ingress           │   │
│  │  ░░  ░░░ ░░░░░░░░░░░ ░░░░░ ░░░░░░  ← Egress            │   │
│  │  1   5   10    15    20    25   31                      │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  By Environment                                                 │
│  ┌────────────┬───────────┬───────────┬───────────┬──────────┐ │
│  │ Env        │ Ingress   │ Egress    │ Messages  │ Cost     │ │
│  ├────────────┼───────────┼───────────┼───────────┼──────────┤ │
│  │ prod       │ 98.2 GB   │ 72.1 GB   │ 38.1M     │ $14.22   │ │
│  │ stage      │ 18.3 GB   │ 12.4 GB   │ 5.2M      │ $2.51    │ │
│  │ dev        │ 8.0 GB    │ 4.7 GB    │ 1.9M      │ $0.63    │ │
│  └────────────┴───────────┴───────────┴───────────┴──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Components**

| Component | File | Purpose |
|-----------|------|---------|
| `UsageSummaryCards` | `components/kafka/UsageSummaryCards.tsx` | Three stat cards with GB/messages and cost |
| `UsageTrendChart` | `components/kafka/UsageTrendChart.tsx` | Line chart using recharts |
| `EnvironmentBreakdownTable` | `components/kafka/EnvironmentBreakdownTable.tsx` | Table with per-environment totals |
| `MonthPicker` | `components/kafka/MonthPicker.tsx` | Dropdown to select billing month |

### Platform Admin Chargeback Dashboard

Location: `orbit-www/src/app/(frontend)/platform/kafka/billing/page.tsx`

**Layout**

```
┌─────────────────────────────────────────────────────────────────┐
│  Platform Kafka Billing                                         │
│  January 2026  ▼                                   [Export CSV] │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Total       │  │  Total       │  │  Applications│          │
│  │  Usage       │  │  Charges     │  │              │          │
│  │  1.24 TB     │  │  $2,847.32   │  │  47          │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Filter: [All Workspaces ▼]  Search: [____________]            │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┬─────────────────┬─────────┬─────────┬──────┐│
│  │ Workspace     │ Application     │ Ingress │ Egress  │ Cost ││
│  ├───────────────┼─────────────────┼─────────┼─────────┼──────┤│
│  │ acme-corp     │ payments-svc    │ 124.5GB │ 89.2GB  │$17.36││
│  │ acme-corp     │ orders-svc      │ 87.3GB  │ 45.1GB  │$11.02││
│  │ globex        │ inventory-svc   │ 234.1GB │ 198.7GB │$33.38││
│  │ initech       │ reporting-svc   │ 56.2GB  │ 112.4GB │$11.24││
│  │ ...           │ ...             │ ...     │ ...     │ ...  ││
│  └───────────────┴─────────────────┴─────────┴─────────┴──────┘│
│                                                                 │
│  Showing 1-25 of 47                        [< Prev] [Next >]   │
└─────────────────────────────────────────────────────────────────┘
```

**Features**

| Feature | Implementation |
|---------|----------------|
| Summary cards | Aggregate totals from chargeback calculation |
| Workspace filter | Dropdown populated from workspaces with Kafka apps |
| Search | Client-side filter by workspace or application name |
| Sortable columns | Click header to sort by ingress, egress, or cost |
| Pagination | 25 rows per page, client-side for MVP |
| CSV Export | Triggers `exportPlatformChargebackCSV` action |

**Access Control**

Page restricted to platform admins via existing `/platform/*` middleware.

---

## Implementation Tasks

### Phase 6.1-6.2: Infrastructure & Bifrost Instrumentation

| Task | Description | Files |
|------|-------------|-------|
| 6.1a | Add Prometheus to docker-compose | `docker-compose.yml` |
| 6.1b | Create Prometheus config directory | `infrastructure/prometheus/` |
| 6.1c | Create Prometheus scrape config | `infrastructure/prometheus/prometheus.yml` |
| 6.2a | Add Micrometer dependency | `gateway/bifrost/build.gradle.kts` |
| 6.2b | Create MetricsConfig class | `gateway/bifrost/src/main/kotlin/.../metrics/MetricsConfig.kt` |
| 6.2c | Create MetricsCollector service | `gateway/bifrost/src/main/kotlin/.../metrics/MetricsCollector.kt` |
| 6.2d | Instrument ProduceRequest filter | `gateway/bifrost/src/main/kotlin/.../filters/ProduceFilter.kt` |
| 6.2e | Instrument FetchResponse filter | `gateway/bifrost/src/main/kotlin/.../filters/FetchFilter.kt` |
| 6.2f | Create admin metrics endpoint | `gateway/bifrost/src/main/kotlin/.../admin/MetricsEndpoint.kt` |

### Phase 6.3: Temporal Workflow

| Task | Description | Files |
|------|-------------|-------|
| 6.3a | Add Prometheus client dependency | `temporal-workflows/go.mod` |
| 6.3b | Create metrics activity types | `temporal-workflows/internal/activities/metrics_types.go` |
| 6.3c | Create metrics activities | `temporal-workflows/internal/activities/metrics_activities.go` |
| 6.3d | Create rollup workflow | `temporal-workflows/internal/workflows/metrics_rollup_workflow.go` |
| 6.3e | Register workflow in worker | `temporal-workflows/cmd/worker/main.go` |
| 6.3f | Create schedule registration | `temporal-workflows/cmd/worker/schedules.go` |

### Phase 6.4: Data Model

| Task | Description | Files |
|------|-------------|-------|
| 6.4a | Extend KafkaUsageMetrics collection | `orbit-www/src/collections/kafka/KafkaUsageMetrics.ts` |
| 6.4b | Create KafkaChargebackRates collection | `orbit-www/src/collections/kafka/KafkaChargebackRates.ts` |
| 6.4c | Register new collection in config | `orbit-www/src/payload.config.ts` |
| 6.4d | Run migrations | `cd orbit-www && pnpm payload migrate` |

### Phase 6.5-6.6: Chargeback Logic

| Task | Description | Files |
|------|-------------|-------|
| 6.5a | Create chargeback types | `orbit-www/src/lib/billing/types.ts` |
| 6.5b | Create chargeback calculation service | `orbit-www/src/lib/billing/chargeback.ts` |
| 6.5c | Create workspace export action | `orbit-www/src/app/(frontend)/[workspace]/kafka/billing/actions.ts` |
| 6.5d | Create platform export action | `orbit-www/src/app/(frontend)/platform/kafka/billing/actions.ts` |

### Phase 6.7-6.8: UI

| Task | Description | Files |
|------|-------------|-------|
| 6.6a | Create UsageSummaryCards component | `orbit-www/src/components/kafka/UsageSummaryCards.tsx` |
| 6.6b | Create UsageTrendChart component | `orbit-www/src/components/kafka/UsageTrendChart.tsx` |
| 6.6c | Create EnvironmentBreakdownTable | `orbit-www/src/components/kafka/EnvironmentBreakdownTable.tsx` |
| 6.6d | Create MonthPicker component | `orbit-www/src/components/kafka/MonthPicker.tsx` |
| 6.6e | Create application usage page | `orbit-www/src/app/(frontend)/[workspace]/kafka/applications/[appSlug]/usage/page.tsx` |
| 6.7a | Create ChargebackTable component | `orbit-www/src/components/kafka/ChargebackTable.tsx` |
| 6.7b | Create PlatformSummaryCards component | `orbit-www/src/components/kafka/PlatformSummaryCards.tsx` |
| 6.7c | Create platform billing page | `orbit-www/src/app/(frontend)/platform/kafka/billing/page.tsx` |

---

## Testing Strategy

### Unit Tests

| Area | Tests |
|------|-------|
| Chargeback calculation | Rate lookup, aggregation, cost calculation, edge cases (zero usage, missing rate) |
| CSV export | Format validation, proper escaping, totals row |
| Temporal activities | Prometheus query parsing, hourly bucketing, upsert logic |

### Integration Tests

| Area | Tests |
|------|-------|
| Bifrost metrics | Produce/consume requests emit correct metrics |
| Prometheus scrape | Metrics endpoint returns valid Prometheus format |
| Workflow end-to-end | Metrics flow from Bifrost → Prometheus → Workflow → Payload |

### E2E Tests

| Area | Tests |
|------|-------|
| Usage dashboard | Displays correct totals for test data |
| Platform billing | Filters work, CSV downloads correctly |
| Month picker | Changing month updates displayed data |

---

## Future Enhancements (Post-MVP)

1. **Per-workspace rate overrides** - Allow negotiated pricing for enterprise workspaces
2. **Usage alerts** - Notify workspace admins when approaching thresholds
3. **Tiered pricing** - Volume discounts based on usage levels
4. **API billing export** - Push chargeback data to external billing systems
5. **Real-time usage widget** - Live updating metrics in dashboard header
6. **Cost forecasting** - Project month-end costs based on current usage rate
