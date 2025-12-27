# Kafka Cluster Management Integration Design

**Date:** 2025-12-27
**Status:** Draft
**Author:** Drew Payment + Claude

## Overview

Orbit Kafka integration provides a unified abstraction layer for managing Kafka clusters across self-hosted and SaaS providers (Confluent Cloud, AWS MSK, etc.). The design emphasizes self-service developer experience with platform-team-defined guardrails.

### Goals

- Abstract away cluster details; developers think in environments, not infrastructure
- Self-service topic creation with policy-based approval workflows
- Cross-workspace topic sharing with discoverable catalog
- Full schema registry integration (centralized)
- Usage tracking for billing and lineage visualization
- Terraform provider for infrastructure-as-code workflows

### Non-Goals (for initial release)

- Cluster provisioning (clusters are pre-provisioned by platform team)
- Message content inspection/debugging
- Real-time streaming UI (consume messages in browser)

---

## Core Domain Model

### KafkaProvider

System-managed collection defining supported Kafka-compatible providers.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier: `apache-kafka`, `confluent-cloud`, `aws-msk`, `redpanda`, `aiven` |
| `displayName` | string | Human-readable name |
| `adapterType` | string | Which Go adapter handles this provider |
| `requiredConfigFields` | array | Connection/auth fields required for this provider |
| `capabilities` | object | Feature flags: `schemaRegistry`, `transactions`, `quotasApi`, `metricsApi` |
| `documentationUrl` | string | Link to provider docs |
| `icon` | relationship | Provider logo |

### KafkaCluster

Registered clusters, managed by platform team.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Cluster identifier |
| `provider` | relationship → KafkaProvider | Which provider type |
| `connectionConfig` | json | Provider-specific config (bootstrap servers, region, etc.) |
| `credentials` | encrypted | Auth credentials (SASL, mTLS certs, API keys) |
| `validationStatus` | enum | `pending`, `valid`, `invalid` |
| `lastValidatedAt` | timestamp | Last successful connection test |
| `environments` | relationship[] → KafkaEnvironmentMapping | Which environments use this cluster |

### KafkaEnvironmentMapping

Maps environments to clusters with routing rules.

| Field | Type | Description |
|-------|------|-------------|
| `environment` | string | `dev`, `staging`, `prod`, etc. |
| `cluster` | relationship → KafkaCluster | Target cluster |
| `routingRule` | object | Optional: region-based, workspace metadata, round-robin |
| `priority` | number | For multiple clusters in same environment |
| `isDefault` | boolean | Default cluster for this environment |

### SchemaRegistry

Centralized schema registry configuration (single global instance).

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Schema Registry endpoint |
| `credentials` | encrypted | Auth credentials |
| `subjectNamingTemplate` | string | Default: `{env}.{workspace}.{topic}-{key\|value}` |
| `defaultCompatibility` | enum | `backward`, `forward`, `full`, `none` |
| `environmentOverrides` | array | Per-environment compatibility settings |

---

## Topic & Schema Model

### KafkaTopic

Workspace-owned topics.

| Field | Type | Description |
|-------|------|-------------|
| `workspace` | relationship → Workspace | Owning workspace |
| `name` | string | Topic name (validated against naming conventions) |
| `environment` | string | Target environment |
| `cluster` | relationship → KafkaCluster | Resolved cluster (stored for reference) |
| `partitions` | number | Partition count |
| `replicationFactor` | number | Replication factor |
| `retentionMs` | number | Retention period in milliseconds |
| `cleanupPolicy` | enum | `delete`, `compact`, `compact,delete` |
| `compression` | enum | `none`, `gzip`, `snappy`, `lz4`, `zstd` |
| `config` | json | Additional topic configs |
| `status` | enum | `pending-approval`, `provisioning`, `active`, `failed`, `deleting` |
| `workflowId` | string | Temporal workflow ID for async tracking |
| `approvalRequired` | boolean | Based on policy evaluation |
| `approvedBy` | relationship → User | Who approved (if required) |
| `approvedAt` | timestamp | Approval timestamp |

### KafkaTopicPolicy

Guardrails for topic creation.

| Field | Type | Description |
|-------|------|-------------|
| `scope` | enum | `platform` (global) or `workspace` (override) |
| `workspace` | relationship → Workspace | If workspace-scoped |
| `environment` | string | Which environment(s) this applies to |
| `namingPattern` | regex | Enforce naming conventions |
| `autoApprovePatterns` | array | Topic patterns that auto-approve |
| `partitionLimits` | object | `{ min, max }` |
| `retentionLimits` | object | `{ min, max }` in milliseconds |
| `requireSchema` | boolean | Must register schema before topic creation |
| `requireApprovalFor` | array | Environments requiring manual approval |

### KafkaSchema

Schemas registered for topics.

| Field | Type | Description |
|-------|------|-------------|
| `workspace` | relationship → Workspace | Owning workspace |
| `topic` | relationship → KafkaTopic | Associated topic |
| `type` | enum | `key`, `value` |
| `subject` | string | Auto-generated: `{env}.{workspace}.{topic}-{type}` |
| `format` | enum | `avro`, `protobuf`, `json` |
| `content` | text | Schema definition |
| `version` | number | Schema Registry version (mirrored) |
| `schemaId` | number | Schema Registry ID |
| `compatibility` | enum | `backward`, `forward`, `full`, `none` |
| `status` | enum | `pending`, `registered`, `failed` |

---

## Access Control Model

### KafkaServiceAccount

Workspace-owned credentials for Kafka access.

| Field | Type | Description |
|-------|------|-------------|
| `workspace` | relationship → Workspace | Owning workspace |
| `name` | string | Service account identifier |
| `type` | enum | `producer`, `consumer`, `producer-consumer`, `admin` |
| `credentials` | encrypted | Provider-specific credentials |
| `status` | enum | `active`, `revoked` |
| `createdBy` | relationship → User | Creator |

### KafkaTopicShare

Cross-workspace access grants.

| Field | Type | Description |
|-------|------|-------------|
| `topic` | relationship → KafkaTopic | Topic being shared |
| `sharedWithType` | enum | `workspace`, `user` |
| `sharedWithWorkspace` | relationship → Workspace | Target workspace (if type=workspace) |
| `sharedWithUser` | relationship → User | Target user (if type=user) |
| `permission` | enum | `read`, `write`, `read-write` |
| `status` | enum | `pending-request`, `approved`, `rejected`, `revoked` |
| `requestedBy` | relationship → User | Who requested access |
| `requestedAt` | timestamp | Request timestamp |
| `justification` | text | Reason for access (if required by policy) |
| `approvedBy` | relationship → User | Who approved |
| `approvedAt` | timestamp | Approval timestamp |
| `expiresAt` | timestamp | Optional expiration |

### KafkaTopicSharePolicy

Rules for visibility and auto-approval.

| Field | Type | Description |
|-------|------|-------------|
| `workspace` | relationship → Workspace | Owning workspace |
| `scope` | enum | `all-topics`, `topic-pattern`, `specific-topic` |
| `topicPattern` | string | Regex or glob pattern |
| `topic` | relationship → KafkaTopic | If scope=specific-topic |
| `environment` | string | Which environment(s) |
| `visibility` | enum | `private`, `discoverable`, `public` |
| `autoApprove` | object | Conditions for automatic approval |
| `autoApprove.environments` | array | Environments that auto-approve |
| `autoApprove.permissions` | array | Permission levels that auto-approve |
| `autoApprove.workspaceWhitelist` | relationship[] → Workspace | Specific workspaces to auto-approve |
| `autoApprove.sameTenantOnly` | boolean | Only auto-approve within tenant |
| `defaultPermission` | enum | Permission level on auto-approve |
| `requireJustification` | boolean | Requestor must provide reason |
| `accessTtl` | number | Optional TTL in days |

---

## Usage & Lineage Model

### KafkaConsumerGroup

Tracked consumer groups (system-managed, read-only).

| Field | Type | Description |
|-------|------|-------------|
| `groupId` | string | Consumer group ID |
| `cluster` | relationship → KafkaCluster | Which cluster |
| `topics` | relationship[] → KafkaTopic | Subscribed topics |
| `serviceAccount` | relationship → KafkaServiceAccount | If resolvable |
| `workspace` | relationship → Workspace | Inferred from service account |
| `currentLag` | number | Total lag across partitions |
| `lastSeen` | timestamp | Last activity |
| `lastUpdated` | timestamp | Last metrics update |

### KafkaUsageMetrics

Aggregated usage data for billing.

| Field | Type | Description |
|-------|------|-------------|
| `topic` | relationship → KafkaTopic | Topic |
| `period` | date | Aggregation period (hourly/daily) |
| `periodType` | enum | `hourly`, `daily` |
| `bytesIn` | number | Bytes produced |
| `bytesOut` | number | Bytes consumed |
| `messageCountIn` | number | Messages produced |
| `messageCountOut` | number | Messages consumed |
| `storageBytes` | number | Current storage size |
| `partitionCount` | number | Partition count |

### KafkaClientActivity

Per-client activity for lineage tracking.

| Field | Type | Description |
|-------|------|-------------|
| `clientId` | string | Producer/consumer client ID |
| `serviceAccount` | relationship → KafkaServiceAccount | If resolvable |
| `workspace` | relationship → Workspace | Inferred workspace |
| `topic` | relationship → KafkaTopic | Topic accessed |
| `direction` | enum | `produce`, `consume` |
| `consumerGroup` | relationship → KafkaConsumerGroup | For consumers |
| `bytesTransferred` | number | Rolling window |
| `lastSeen` | timestamp | Last activity |

---

## Service Architecture

### Go Service: `kafka-service`

```
services/kafka/
  cmd/server/
    main.go
  internal/
    domain/
      provider.go
      cluster.go
      topic.go
      schema.go
      service_account.go
      share.go
      policy.go
      metrics.go
    service/
      cluster_service.go
      topic_service.go
      schema_service.go
      share_service.go
      policy_evaluator.go
      metrics_service.go
    grpc/
      server.go
      cluster_handler.go
      topic_handler.go
      schema_handler.go
      share_handler.go
    adapters/
      adapter.go           # Interface definitions
      confluent/
        client.go          # Confluent Cloud REST API
        metrics.go
      apache/
        client.go          # Direct Kafka Admin Client
        metrics.go
      msk/
        client.go          # AWS MSK APIs
      schema/
        client.go          # Schema Registry client
    temporal/
      workflows/
        topic_provisioning.go
        metrics_collection.go
        acl_sync.go
        lineage_discovery.go
      activities/
        kafka_activities.go
        schema_activities.go
        acl_activities.go
```

### Adapter Interfaces

```go
type KafkaAdapter interface {
    // Cluster operations
    ValidateConnection(ctx context.Context, config ClusterConfig) error

    // Topic operations
    CreateTopic(ctx context.Context, topic TopicSpec) error
    DeleteTopic(ctx context.Context, topicName string) error
    DescribeTopic(ctx context.Context, topicName string) (*TopicInfo, error)
    UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error
    ListTopics(ctx context.Context) ([]string, error)

    // ACL operations
    CreateACL(ctx context.Context, acl ACLSpec) error
    DeleteACL(ctx context.Context, acl ACLSpec) error
    ListACLs(ctx context.Context) ([]ACLInfo, error)

    // Metrics (optional capability)
    GetTopicMetrics(ctx context.Context, topicName string) (*TopicMetrics, error)
    GetConsumerGroupLag(ctx context.Context, groupID string) (*LagInfo, error)
    ListConsumerGroups(ctx context.Context) ([]ConsumerGroupInfo, error)
}

type SchemaRegistryAdapter interface {
    RegisterSchema(ctx context.Context, subject string, schema SchemaSpec) (int, error)
    GetSchema(ctx context.Context, subject string, version int) (*SchemaInfo, error)
    GetLatestSchema(ctx context.Context, subject string) (*SchemaInfo, error)
    ListVersions(ctx context.Context, subject string) ([]int, error)
    CheckCompatibility(ctx context.Context, subject string, schema SchemaSpec) (bool, error)
    DeleteSubject(ctx context.Context, subject string) error
    ListSubjects(ctx context.Context) ([]string, error)
}
```

### Temporal Workflows

**TopicProvisioningWorkflow**
1. Validate topic config against policies
2. Check approval status (wait if pending)
3. Resolve cluster from environment mapping
4. Create topic on cluster
5. Create ACLs for owning workspace
6. Register schema (if provided)
7. Update topic status to `active`

**MetricsCollectionWorkflow**
1. Run on schedule (hourly)
2. For each active cluster:
   - Query topic metrics
   - Query consumer group lag
   - Upsert KafkaUsageMetrics records
3. Aggregate for billing reports

**ACLSyncWorkflow**
1. Run on schedule or triggered by share changes
2. For each cluster:
   - Load all KafkaTopicShare grants
   - Compare to cluster ACLs
   - Add missing ACLs
   - Remove revoked ACLs

**LineageDiscoveryWorkflow**
1. Run on schedule (daily)
2. For each cluster:
   - Query client activity from metrics/logs
   - Match client IDs to service accounts
   - Update KafkaClientActivity records
   - Compute lineage graph

---

## Terraform Provider

### Structure

```
terraform-provider-orbit/
  main.go
  internal/
    provider/
      provider.go
    resources/
      kafka_topic.go
      kafka_schema.go
      kafka_topic_share.go
      kafka_service_account.go
    datasources/
      kafka_topics.go
      kafka_environments.go
      kafka_clusters.go
      kafka_schemas.go
```

### Resources

**orbit_kafka_topic**
```hcl
resource "orbit_kafka_topic" "orders" {
  workspace    = "payments-team"
  environment  = "prod"
  name         = "orders"
  partitions   = 12
  retention_ms = 604800000  # 7 days

  config = {
    "cleanup.policy" = "delete"
    "compression.type" = "lz4"
  }
}
```

**orbit_kafka_schema**
```hcl
resource "orbit_kafka_schema" "orders_value" {
  topic  = orbit_kafka_topic.orders.id
  type   = "value"
  format = "avro"
  schema = file("${path.module}/schemas/order.avsc")
}
```

**orbit_kafka_topic_share**
```hcl
resource "orbit_kafka_topic_share" "orders_to_analytics" {
  topic      = orbit_kafka_topic.orders.id
  workspace  = "analytics-team"
  permission = "read"
}
```

**orbit_kafka_service_account**
```hcl
resource "orbit_kafka_service_account" "orders_producer" {
  workspace = "payments-team"
  name      = "orders-producer"
  type      = "producer"
}

output "credentials" {
  value     = orbit_kafka_service_account.orders_producer.credentials
  sensitive = true
}
```

### Data Sources

**data.orbit_kafka_topics**
```hcl
data "orbit_kafka_topics" "my_topics" {
  workspace   = "payments-team"
  environment = "prod"
}
```

**data.orbit_kafka_environments**
```hcl
data "orbit_kafka_environments" "available" {}
```

### Provider Configuration

```hcl
provider "orbit" {
  endpoint = "https://orbit.company.com"  # Or ORBIT_ENDPOINT env var
  token    = var.orbit_token               # Or ORBIT_TOKEN env var
}
```

### Async Handling

- `terraform plan` validates against Orbit policies (fast feedback)
- `terraform apply` triggers Orbit workflows
- Provider polls workflow status until complete
- If approval required, returns pending state with message
- User approves in Orbit UI, re-runs `terraform apply`

---

## Frontend Collections

### Payload CMS Collections

| Collection | Scope | Access |
|------------|-------|--------|
| `KafkaProviders` | System | Platform admin |
| `KafkaClusters` | Platform | Platform admin |
| `KafkaEnvironmentMappings` | Platform | Platform admin |
| `SchemaRegistries` | Platform | Platform admin |
| `KafkaTopics` | Workspace | Workspace members |
| `KafkaSchemas` | Workspace | Workspace members |
| `KafkaServiceAccounts` | Workspace | Workspace admin |
| `KafkaTopicShares` | Workspace | Workspace members |
| `KafkaTopicSharePolicies` | Workspace | Workspace admin |
| `KafkaConsumerGroups` | System | Read-only |
| `KafkaUsageMetrics` | System | Read-only |
| `KafkaClientActivity` | System | Read-only |

---

## UI Routes

### Developer View (Workspace-Scoped)

| Route | Description |
|-------|-------------|
| `/workspaces/[id]/kafka` | Dashboard: topics, schemas, usage summary |
| `/workspaces/[id]/kafka/topics` | Topic list, create topic |
| `/workspaces/[id]/kafka/topics/[id]` | Topic detail: config, schema, consumers, sharing |
| `/workspaces/[id]/kafka/schemas` | Schema list and versions |
| `/workspaces/[id]/kafka/discover` | Browse discoverable topics, request access |
| `/workspaces/[id]/kafka/access-requests` | Pending inbound/outbound share requests |
| `/workspaces/[id]/kafka/service-accounts` | Manage service accounts |
| `/workspaces/[id]/kafka/policies` | Workspace share policies |

### Global Catalog

| Route | Description |
|-------|-------------|
| `/kafka` | Global Kafka catalog: all discoverable topics |

**Catalog Features:**
- Lists topics where visibility is `discoverable` or `public`
- Also shows topics in user's member workspaces
- Filterable by: environment, workspace, schema format, tags
- Searchable by topic name, description
- Access status: "You have access", "Request access", "Public", "Member"
- One-click access request

### Platform Admin View

| Route | Description |
|-------|-------------|
| `/settings/kafka/providers` | Manage provider definitions |
| `/settings/kafka/clusters` | Register clusters, test connections |
| `/settings/kafka/environments` | Environment → cluster mappings |
| `/settings/kafka/schema-registry` | Schema registry configuration |
| `/settings/kafka/policies` | Platform-wide default policies |
| `/settings/kafka/usage` | Usage reports, billing data |
| `/settings/kafka/lineage` | Lineage explorer (who produces/consumes) |

---

## Error Handling

### Cluster Connectivity

- Validate connection on cluster registration
- Periodic health check workflow updates cluster status
- Topics show "cluster unreachable" state on failures
- Retry with exponential backoff for transient failures

### Policy Conflicts

- Platform policies take precedence over workspace policies
- Most restrictive policy wins
- Clear error messages: "Denied: exceeds platform limit of 50 partitions"

### Schema Compatibility

- Pre-validate schema before topic creation
- Block incompatible evolutions with clear message
- Admin override option for breaking changes (with approval)

### Cross-Workspace Access

- Workspace deleted → revoke all shares, notify consumers
- Topic deleted → cascade delete shares, notify with lead time
- Service account revoked → immediate ACL removal

### Terraform State Drift

- Orbit is source of truth
- `terraform plan` detects drift
- User chooses: import current state or revert to Terraform config

### Async Failures

- Workflow failures surface in UI with retry option
- Terraform provider returns error on timeout
- Dead-letter handling for repeated failures

### Rate Limiting

- Per-workspace limits: max topics, partitions, schemas
- Platform limits: requests per minute to external APIs
- Graceful degradation: queue requests if rate limited

---

## Security Considerations

- Cluster credentials encrypted at rest (matching registry pattern)
- Service account credentials never exposed in API responses
- Query isolation by workspace membership
- Schema Registry access mediated through Orbit (no direct access)
- Audit logging for all topic/ACL/share operations
- Terraform state contains workflow IDs, not cluster credentials

---

## Future Considerations (Out of Scope)

- Cluster provisioning via Terraform/Pulumi
- Message inspection/debugging UI
- Dead-letter queue management
- Kafka Connect integration
- Stream processing (ksqlDB, Flink) integration
- Multi-region replication management
