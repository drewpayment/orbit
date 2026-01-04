# Kafka Gateway Self-Service Design (Project Bifrost)

**Status:** APPROVED
**Date:** 2026-01-03
**Authors:** Platform Engineering

## 1. Overview & Architecture

**Project Bifrost: Kafka Self-Service Gateway for Orbit**

Bifrost provides self-service Kafka access to Orbit workspaces while abstracting underlying cluster infrastructure. Teams get autonomous Kafka capabilities; platform admins maintain governance and cost visibility.

### Core Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Orbit Platform                             │
├─────────────────────────────────────────────────────────────────────┤
│  Payload CMS (Source of Truth)                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │
│  │Applications │ │VirtualClust.│ │ KafkaTopics │ │ServiceAccounts│  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  Temporal (Orchestration)                                            │
│  ┌─────────────────────┐ ┌─────────────────────┐                    │
│  │ ConfigSyncWorkflow  │ │ TopicSyncWorkflow   │                    │
│  └─────────────────────┘ └─────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ gRPC
┌─────────────────────────────────────────────────────────────────────┐
│                         Bifrost Gateway                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                 │
│  │ Bifrost-Dev  │ │Bifrost-Stage │ │ Bifrost-Prod │                 │
│  │    :9092     │ │    :9092     │ │    :9092     │                 │
│  └──────────────┘ └──────────────┘ └──────────────┘                 │
│         │                │                │                          │
│         ▼                ▼                ▼                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Filter Chain                               │   │
│  │  [Auth] → [Virtualization] → [Policy] → [Metrics] → [Route]  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ Kafka Protocol
┌─────────────────────────────────────────────────────────────────────┐
│                     Physical Infrastructure                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │
│  │ Kafka Dev   │ │ Kafka Stage │ │ Kafka Prod  │                    │
│  └─────────────┘ └─────────────┘ └─────────────┘                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │
│  │ SR Dev      │ │ SR Stage    │ │ SR Prod     │                    │
│  └─────────────┘ └─────────────┘ └─────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Bifrost Gateway:** Kotlin + Kroxylicious (Netty)
- **Control Plane:** Go services + Temporal workflows
- **Metadata Store:** Payload CMS (PostgreSQL)
- **Metrics:** Prometheus/OTLP → Orbit aggregation

---

## 2. Tenant Model & Hierarchy

### Resource Hierarchy

```
Workspace (Tenant Boundary)
└── Application (Team-defined logical grouping)
    └── Virtual Cluster (one per environment)
        ├── Service Accounts (multiple, with permission templates)
        ├── Topics (namespaced, policy-gated)
        ├── Schemas (synced from Schema Registry)
        └── Consumer Groups (passively tracked)
```

### Example

```
Workspace: acme-corp
├── Application: payments-service
│   ├── Virtual Cluster: acme-payments-dev
│   │   ├── Endpoint: payments-service-dev.dev.kafka.orbit.io:9092
│   │   ├── Topic Prefix: acme-payments-dev-
│   │   ├── Service Accounts:
│   │   │   ├── acme-payments-dev-producer (producer template)
│   │   │   ├── acme-payments-dev-consumer (consumer template)
│   │   │   └── acme-payments-dev-admin (admin template)
│   │   └── Topics:
│   │       ├── orders (physical: acme-payments-dev-orders)
│   │       └── refunds (physical: acme-payments-dev-refunds)
│   ├── Virtual Cluster: acme-payments-stage
│   │   └── ...
│   └── Virtual Cluster: acme-payments-prod
│       └── ...
└── Application: order-processing
    └── ...
```

### Quota Model

| Level | Setting | Default |
|-------|---------|---------|
| System | `defaultApplicationQuota` | 5 |
| Workspace | `applicationQuotaOverride` | null (uses system) |

### Approval Flow (when quota exceeded)

```
Workspace member requests Application #6
  ↓
Request status: pending_workspace_approval
  ↓
Workspace Admin approves
  ↓
Request status: pending_platform_approval
  ↓
Platform Admin either:
  A) Approves single request → Application created
  B) Increases workspace quota → Application created + future auto-provisioning
```

---

## 3. Gateway Entry Points & Routing

### Environment-Based Gateway Clusters

| Environment | Gateway Endpoint | Bifrost Deployment | Physical Cluster |
|-------------|------------------|-------------------|------------------|
| dev | `*.dev.kafka.orbit.io:9092` | Bifrost-Dev | via KafkaEnvironmentMappings |
| stage | `*.stage.kafka.orbit.io:9092` | Bifrost-Stage | via KafkaEnvironmentMappings |
| prod | `*.prod.kafka.orbit.io:9092` | Bifrost-Prod | via KafkaEnvironmentMappings |

### SNI-Based Tenant Routing

Clients connect using application-specific hostnames. Gateway extracts tenant from SNI.

```
Client connects to: payments-service.dev.kafka.orbit.io:9092
                    └──────┬──────┘ └┬┘
                      App slug    Environment

Gateway:
  1. TLS handshake, extract SNI: payments-service.dev.kafka.orbit.io
  2. Parse: application=payments-service, env=dev
  3. Lookup Virtual Cluster: acme-payments-dev
  4. Apply tenant context to connection
```

### Client Configuration Example

```properties
# payments-service application, dev environment
bootstrap.servers=payments-service.dev.kafka.orbit.io:9092
security.protocol=SASL_SSL
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required \
  username="acme-payments-dev-producer" \
  password="<credential-from-orbit>";
```

### DNS & Certificate Strategy

```
Wildcard DNS:
  *.dev.kafka.orbit.io   → Bifrost-Dev NLB
  *.stage.kafka.orbit.io → Bifrost-Stage NLB
  *.prod.kafka.orbit.io  → Bifrost-Prod NLB

Wildcard TLS Certificates:
  *.dev.kafka.orbit.io
  *.stage.kafka.orbit.io
  *.prod.kafka.orbit.io
```

---

## 4. Authentication & Service Accounts

### Authentication Method

- **MVP:** SASL/PLAIN over TLS
- **Future:** SASL/OAUTHBEARER, SASL/SCRAM-SHA-512

### Service Account Templates

| Template | Topic Permissions | Group Permissions | Admin Permissions |
|----------|-------------------|-------------------|-------------------|
| `producer` | Write, DescribeConfigs | — | — |
| `consumer` | Read, DescribeConfigs | Read, Describe | — |
| `admin` | All | All | CreateTopics, DeleteTopics, AlterConfigs |
| `custom` | User-defined | User-defined | User-defined |

### Credential Lifecycle

```
Team creates Service Account in Orbit UI
  ↓
Orbit generates:
  - username: {workspace}-{app}-{env}-{name}
  - password: cryptographically random, 32+ chars
  ↓
Credentials stored encrypted in Payload (KafkaServiceAccounts)
  ↓
Temporal: CredentialSyncWorkflow
  ↓
Bifrost Admin API: UpsertCredential
  ↓
Gateway credential store updated
  ↓
Client can authenticate
```

### Credential Operations

| Operation | Flow |
|-----------|------|
| Create | Orbit → Temporal → Bifrost |
| Rotate | User triggers in UI → new password generated → immediate sync to Bifrost → old credential invalidated |
| Revoke | User triggers → immediate Temporal workflow (not batched) → Bifrost removes credential |

### Gateway Authentication Flow

```
Client: SASL/PLAIN handshake (username + password)
  ↓
Bifrost: Lookup credential in local store
Bifrost: Validate password hash
Bifrost: Extract tenant context (workspace, app, env)
Bifrost: Load permissions (template-based ACLs)
  ↓
Connection authenticated, tenant context attached
  ↓
All subsequent requests filtered by permissions
```

---

## 5. Topic Management & Policies

### Topic Creation Modes

| Environment | Mode | Policy Violation Behavior |
|-------------|------|---------------------------|
| dev | Gateway passthrough | Reject request, return POLICY_VIOLATION |
| stage | Gateway passthrough | Reject request, return POLICY_VIOLATION |
| prod | Gateway passthrough | Reject request, return POLICY_VIOLATION |

All environments: if request complies with policy → instant provisioning via Gateway.

### Policy Configuration (per environment)

```yaml
KafkaTopicPolicy:
  environment: prod
  constraints:
    maxPartitions: 50
    minPartitions: 3
    maxRetentionMs: 604800000  # 7 days
    minReplicationFactor: 3
    allowedCleanupPolicies: [delete, compact]
    namingPattern: "^[a-z][a-z0-9-]*$"  # lowercase, alphanumeric, hyphens
```

### Topic Provisioning Flow (compliant request)

```
Client: kafka-topics --create --topic orders --partitions 12
  ↓
Bifrost: Intercept CreateTopics
Bifrost: Identify tenant → acme-payments-dev
Bifrost: Load policy for dev environment
Bifrost: Validate request:
  - partitions 12 ≤ 50 ✓
  - name matches pattern ✓
  ↓
Bifrost: Rewrite topic name → acme-payments-dev-orders
Bifrost: Forward to physical cluster
  ↓
Physical cluster: Topic created
  ↓
Bifrost: Trigger Temporal workflow → TopicCreatedSyncWorkflow
  ↓
Orbit: KafkaTopic record created
  - name: orders
  - physicalName: acme-payments-dev-orders
  - application: payments-service
  - virtualCluster: acme-payments-dev
  - createdVia: gateway-passthrough
```

### Topic Provisioning Flow (policy violation)

```
Client: kafka-topics --create --topic orders --partitions 100
  ↓
Bifrost: Validate request:
  - partitions 100 > 50 ✗
  ↓
Bifrost: Return error to client
  - Error code: POLICY_VIOLATION
  - Message: "Partition count 100 exceeds maximum 50"
  ↓
Client must request via Orbit UI for approval
  ↓
Workspace Admin approves exception
  ↓
Temporal: TopicProvisionWorkflow (creates with override)
  ↓
Bifrost: Synced via config push
```

### Topic Visibility Tiers

| Visibility | Who Can See | Access |
|------------|-------------|--------|
| `private` | Owning Application only | Automatic |
| `workspace` | Any Application in same Workspace | Auto-approved |
| `discoverable` | Listed in catalog, any Workspace | Request + approval |
| `public` | All Applications | No approval needed |

### Topic Sharing Flow

```
App B wants to consume from App A's topic "orders" (discoverable)
  ↓
App B team browses Topic Catalog in Orbit
App B team clicks "Request Access" on orders
  - Permission: read
  ↓
Request created: KafkaTopicShare (status: pending)
  ↓
App A team (owner) receives notification
App A team approves
  ↓
Temporal: TopicShareApprovedWorkflow
  - Updates Bifrost ACLs for App B's service accounts
  ↓
App B can now consume from acme-payments-dev-orders
  (they see it as "orders" via catalog, but use their own client config)
```

---

## 6. Control Plane & Temporal Integration

### Sync Architecture

```
Orbit (Payload CMS)
       │
       ▼ Mutations trigger workflows
Temporal
       │
       ├── GatewayConfigSyncWorkflow (long-running, batched)
       │     └── Periodic sync of policies, quotas, non-critical config
       │
       ├── CredentialSyncWorkflow (immediate)
       │     └── Create, rotate, revoke credentials
       │
       ├── TopicCreatedSyncWorkflow (from Bifrost → Orbit)
       │     └── Record topics created via gateway passthrough
       │
       └── ApplicationCleanupWorkflow (deferred)
             └── Grace period countdown, resource cleanup
       │
       ▼ gRPC
Bifrost Admin API
```

### Workflow Definitions

| Workflow | Trigger | Priority | Behavior |
|----------|---------|----------|----------|
| `GatewayConfigSyncWorkflow` | Timer (every 30s) | Normal | Batch non-critical updates (policies, quotas) |
| `CredentialUpsertWorkflow` | Service account created/rotated | Immediate | Push credential to Bifrost |
| `CredentialRevokeWorkflow` | Service account revoked | Immediate | Remove credential from Bifrost |
| `VirtualClusterProvisionWorkflow` | Application created | Immediate | Create 3 virtual clusters, push to Bifrost |
| `TopicCreatedSyncWorkflow` | Bifrost webhook | Normal | Create KafkaTopic record in Orbit |
| `TopicDeletedSyncWorkflow` | Bifrost webhook | Normal | Mark KafkaTopic as deleted |
| `ConsumerGroupSyncWorkflow` | Timer (every 60s) | Low | Update consumer group activity |
| `UsageMetricsRollupWorkflow` | Timer (every 5m) | Low | Aggregate metrics into KafkaUsageMetrics |
| `ApplicationCleanupWorkflow` | Application decommissioned | Deferred | Wait grace period, then cleanup |

### Bifrost Admin API (gRPC)

```protobuf
service BifrostAdminService {
  // Virtual Cluster lifecycle
  rpc UpsertVirtualCluster(UpsertVirtualClusterRequest) returns (UpsertVirtualClusterResponse);
  rpc DeleteVirtualCluster(DeleteVirtualClusterRequest) returns (DeleteVirtualClusterResponse);

  // Credential management
  rpc UpsertCredential(UpsertCredentialRequest) returns (UpsertCredentialResponse);
  rpc RevokeCredential(RevokeCredentialRequest) returns (RevokeCredentialResponse);

  // Policy sync
  rpc UpsertPolicy(UpsertPolicyRequest) returns (UpsertPolicyResponse);

  // Topic ACLs (for sharing)
  rpc UpdateTopicACL(UpdateTopicACLRequest) returns (UpdateTopicACLResponse);

  // Health & status
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
  rpc ListVirtualClusters(ListVirtualClustersRequest) returns (ListVirtualClustersResponse);
}
```

### Startup Reconciliation

```
Bifrost Gateway starts
  ↓
Calls Orbit API: GET /api/gateway/full-config
  ↓
Receives:
  - All virtual clusters
  - All credentials
  - All policies
  - All topic ACLs
  ↓
Builds in-memory state
  ↓
Ready to accept connections
```

---

## 7. Metrics, Chargeback & Lineage

### Metrics Collection

```
Bifrost Gateway
  │
  ├── Per-request metrics (hot path)
  │   └── Counters: bytes_in, bytes_out, message_count, request_count
  │   └── Labels: virtual_cluster, topic, service_account, direction
  │
  └── Emit via Prometheus/OTLP
        │
        ▼
Prometheus / Metrics Backend
        │
        ▼ (Temporal: UsageMetricsRollupWorkflow, every 5m)
Orbit: KafkaUsageMetrics collection
```

### Metrics Schema

```
KafkaUsageMetrics:
  - virtualCluster: acme-payments-prod
  - application: payments-service
  - workspace: acme-corp
  - windowStart: 2026-01-03T00:00:00Z
  - windowEnd: 2026-01-03T01:00:00Z
  - bytesIn: 1234567890
  - bytesOut: 9876543210
  - messageCountIn: 500000
  - messageCountOut: 2000000
  - requestCount: 150000
```

### Chargeback Model

| Setting | Scope | Example |
|---------|-------|---------|
| `costPerGBIn` | System-wide | $0.10 |
| `costPerGBOut` | System-wide | $0.05 |
| `costPerMillionMessages` | System-wide | $0.01 |

### Chargeback Calculation

```
Monthly cost for acme-payments-prod:
  Ingress:  500 GB × $0.10 = $50.00
  Egress:   2 TB × $0.05  = $100.00
  Messages: 50M × $0.01   = $0.50
  ─────────────────────────────────
  Total:                   $150.50
```

### Chargeback Export

- CSV export from Orbit UI (per workspace, per application, per time range)
- Aggregation views: daily, weekly, monthly, YTD

### Activity-Based Lineage

```
KafkaClientActivity:
  - serviceAccount: acme-payments-prod-producer
  - application: payments-service
  - virtualCluster: acme-payments-prod
  - topic: orders
  - direction: PRODUCE
  - bytesTotal: 123456789
  - messageCount: 50000
  - firstSeen: 2026-01-01T00:00:00Z
  - lastSeen: 2026-01-03T12:34:56Z
```

### Lineage Visualization (per topic)

```
Topic: orders (acme-payments-prod)

Producers:
  └── payments-service (acme-payments-prod-producer)
      └── 1.2M messages/day, 50 GB/day

Consumers:
  ├── order-processing (acme-orders-prod-consumer)
  │   └── 1.2M messages/day, 50 GB/day
  └── analytics-pipeline (analytics-prod-consumer) [shared]
      └── 1.2M messages/day, 50 GB/day
```

---

## 8. Schema Registry Integration

### Architecture

```
Per-Environment Schema Registries:

dev.kafka.orbit.io    → Schema Registry Dev
stage.kafka.orbit.io  → Schema Registry Stage
prod.kafka.orbit.io   → Schema Registry Prod
```

### Subject Namespacing

| Client Sees | Physical Subject |
|-------------|------------------|
| `orders-value` | `acme-payments-dev-orders-value` |
| `orders-key` | `acme-payments-dev-orders-key` |

### Gateway Schema Handling

```
Producer sends message with Schema ID 42
  ↓
Bifrost: Extract Schema ID from payload (Magic Byte + 4 bytes)
Bifrost: Lookup in Schema Registry (cached)
  - Cache hit → continue
  - Cache miss → fetch from registry, cache result
Bifrost: Validate schema exists and is compatible
  ↓
If valid: forward to broker
If invalid: return INVALID_SCHEMA error
```

### Schema Registry Passthrough

Clients can also interact with Schema Registry directly via Bifrost:

```
Client: POST /subjects/orders-value/versions
  ↓
Bifrost: Rewrite subject → acme-payments-dev-orders-value
Bifrost: Forward to Schema Registry Dev
  ↓
Schema registered
  ↓
Bifrost: Trigger Temporal → SchemaSyncWorkflow
  ↓
Orbit: KafkaSchema record created (for visibility)
```

### Orbit Sync (Schema Registry as source of truth)

```
Temporal: SchemaSyncWorkflow (periodic, every 5m)
  ↓
Activity: FetchSchemaUpdates
  - Query Schema Registry for subjects matching tenant prefixes
  - Compare with Orbit's KafkaSchemas collection
  ↓
Activity: UpsertSchemaRecords
  - Create/update KafkaSchema records in Orbit
  ↓
Orbit UI shows current schemas per topic
```

### Schema Visibility in Orbit

```
KafkaSchema:
  - subject: orders-value (virtual name)
  - physicalSubject: acme-payments-dev-orders-value
  - topic: orders
  - virtualCluster: acme-payments-dev
  - version: 3
  - schemaType: AVRO
  - schema: "{...}"
  - compatibility: BACKWARD
  - registeredAt: 2026-01-03T12:00:00Z
```

---

## 9. Consumer Group Tracking

### Passive Tracking Architecture

```
Client: JoinGroup request
  ↓
Bifrost: Intercept JoinGroup
Bifrost: Extract group.id, rewrite with prefix
Bifrost: Forward to broker
  ↓
Bifrost: Emit event → ConsumerGroupActivity
  ↓
Temporal: ConsumerGroupSyncWorkflow (batched, every 60s)
  ↓
Orbit: KafkaConsumerGroups collection updated
```

### Tracked Operations

| Kafka Operation | Data Captured |
|-----------------|---------------|
| `FindCoordinator` | Group exists, coordinator lookup |
| `JoinGroup` | Member joined, subscribed topics, rebalance |
| `SyncGroup` | Assignment complete |
| `Heartbeat` | Member still active |
| `LeaveGroup` | Member departed |
| `OffsetCommit` | Latest committed offsets |

### Consumer Group Record

```
KafkaConsumerGroup:
  - groupId: order-processor (virtual name)
  - physicalGroupId: acme-payments-dev-order-processor
  - virtualCluster: acme-payments-dev
  - application: payments-service
  - subscribedTopics: [orders, inventory]
  - memberCount: 3
  - state: Stable | Rebalancing | Empty | Dead
  - lastActivity: 2026-01-03T12:34:56Z
  - lagPerPartition:
      orders-0: 150
      orders-1: 42
      orders-2: 0
```

### Staleness Handling

```
ConsumerGroupSyncWorkflow:
  ↓
For each tracked group:
  - If lastActivity > 24h ago AND state = Empty
    → Mark as inactive
  - If lastActivity > 7d ago AND state = inactive
    → Archive record (retain for lineage history)
```

### Consumer Lag Monitoring

```
Temporal: ConsumerLagCheckWorkflow (every 5m)
  ↓
Activity: FetchConsumerLag
  - Query Bifrost for current consumer offsets
  - Query broker for latest topic offsets
  - Calculate lag per partition
  ↓
Activity: UpdateLagMetrics
  - Store in KafkaConsumerGroups.lagPerPartition
  ↓
Orbit UI: Display lag per consumer group
```

---

## 10. Application Lifecycle

### Application States

```
┌──────────┐     create      ┌──────────┐
│          │ ──────────────► │          │
│  (none)  │                 │  active  │
│          │                 │          │
└──────────┘                 └────┬─────┘
                                  │
                            delete request
                                  │
                                  ▼
                           ┌──────────────────┐
                           │  decommissioning │◄─────────────┐
                           │   (read-only)    │              │
                           └────────┬─────────┘              │
                                    │                        │
                   ┌────────────────┼────────────────┐       │
                   │                │                │       │
             grace period     admin force       user cancel  │
                expires         delete               │       │
                   │                │                └───────┘
                   ▼                ▼
             ┌──────────┐    ┌──────────┐
             │ deleted  │    │ deleted  │
             │ (audit)  │    │ (audit)  │
             └──────────┘    └──────────┘
```

### Grace Periods

| Environment | Grace Period |
|-------------|--------------|
| dev | 7 days |
| stage | 14 days |
| prod | 30 days |

### Deletion Options

| Action | Who | Behavior |
|--------|-----|----------|
| Delete | Application owner | Enters grace period, read-only |
| Cancel | Application owner | Restores to active (during grace period) |
| Force Delete | Workspace Admin | Skips remaining grace period, immediate cleanup |
| Force Delete | Platform Admin | Skips remaining grace period, immediate cleanup |

### Decommissioning Behavior

| Operation | Behavior During Grace Period |
|-----------|------------------------------|
| Produce | Rejected (CLUSTER_AUTHORIZATION_FAILED) |
| Consume | Allowed (read-only access) |
| CreateTopics | Rejected |
| DeleteTopics | Rejected |
| Schema registration | Rejected |
| Consumer group join | Allowed (existing groups can continue) |

### Deletion Flow

```
User requests Application deletion in Orbit UI
  ↓
Confirmation dialog:
  "This will delete payments-service and all its resources.
   Grace period: 30 days (prod)
   You can cancel during the grace period."
  ↓
User confirms
  ↓
Application.status → decommissioning
Application.decommissioningStartedAt → now
  ↓
Temporal: VirtualClusterReadOnlyWorkflow
  - Push read-only config to Bifrost (all 3 virtual clusters)
  ↓
Temporal: ApplicationCleanupWorkflow (scheduled for grace period end)
  ↓
... grace period ...
  ↓
User can cancel: Application.status → active, workflows cancelled
  ↓
... grace period expires ...
  ↓
ApplicationCleanupWorkflow executes:
  ├── Delete physical topics from brokers
  ├── Delete schemas from Schema Registry
  ├── Revoke all credentials from Bifrost
  ├── Delete Virtual Cluster configs from Bifrost
  ├── Archive metrics data (retain for chargeback history)
  └── Mark Application.status → deleted
  ↓
Application record retained for audit (soft delete)
```

### Force Delete Flow

```
Admin clicks "Force Delete" during grace period
  ↓
Confirmation dialog:
  "This will IMMEDIATELY and PERMANENTLY delete payments-service.
   All topics, schemas, and credentials will be removed.
   This action cannot be undone."
  ↓
Requires typing application name to confirm
  ↓
Admin confirms
  ↓
Temporal: Cancel scheduled ApplicationCleanupWorkflow
Temporal: ApplicationCleanupWorkflow (execute immediately)
  ├── Delete physical topics from brokers
  ├── Delete schemas from Schema Registry
  ├── Revoke all credentials from Bifrost
  ├── Delete Virtual Cluster configs from Bifrost
  ├── Archive metrics data
  └── Mark Application.status → deleted
  ↓
Audit log entry:
  - action: force_delete
  - actor: admin@acme-corp.com
  - reason: (optional, captured in dialog)
  - timestamp: 2026-01-03T12:34:56Z
```

### Restoration (during grace period)

```
User clicks "Cancel Decommissioning" in Orbit UI
  ↓
Application.status → active
Application.decommissioningStartedAt → null
  ↓
Temporal: Cancel ApplicationCleanupWorkflow
Temporal: VirtualClusterRestoreWorkflow
  - Push full-access config to Bifrost
  ↓
Application fully operational again
```

---

## 11. Disaster Recovery & Backup

### Backup Scope

| Data | Backed Up | Location | Retention |
|------|-----------|----------|-----------|
| Application definitions | Yes | Payload DB backups | Standard DB retention |
| Virtual Cluster configs | Yes | Payload DB backups | Standard DB retention |
| Topic configs (partitions, retention, etc.) | Yes | Payload DB backups | Standard DB retention |
| Schema versions | Yes (synced) | Payload DB backups | Standard DB retention |
| Service account definitions | Yes | Payload DB backups | Standard DB retention |
| Service account passwords | Yes (encrypted) | Payload DB backups | Standard DB retention |
| Policies and quotas | Yes | Payload DB backups | Standard DB retention |
| Consumer group offsets | Yes (checkpointed) | Payload DB | 30 days rolling |
| Usage metrics | Yes | Payload DB | 12 months |
| Message data | No | Kafka replication | Kafka retention policy |

### Offset Checkpointing

```
Temporal: OffsetCheckpointWorkflow (every 15m)
  ↓
Activity: FetchAllConsumerOffsets
  - For each active consumer group
  - Query committed offsets from Bifrost/broker
  ↓
Activity: StoreOffsetCheckpoint
  - Write to KafkaOffsetCheckpoints collection
  ↓
Checkpoint stored
```

### Offset Checkpoint Record

```
KafkaOffsetCheckpoint:
  - consumerGroup: order-processor
  - virtualCluster: acme-payments-prod
  - checkpointedAt: 2026-01-03T12:30:00Z
  - offsets:
      orders-0: 15234567
      orders-1: 15234890
      orders-2: 15235012
```

### Recovery Scenarios

| Scenario | Recovery Process |
|----------|------------------|
| Bifrost node failure | NLB routes to healthy nodes, stateless recovery |
| Bifrost cluster failure | Restart pods, full config sync from Orbit on startup |
| Physical Kafka cluster failure | Kafka replication handles, Bifrost reconnects automatically |
| Orbit database restore | Bifrost full sync on next reconciliation |
| Consumer needs offset reset | Restore from checkpoint, apply via Temporal workflow |

### Offset Recovery Flow

```
Team requests offset recovery for consumer group "order-processor"
  ↓
Orbit UI: Select checkpoint to restore from
  - 2026-01-03T12:30:00Z (15 min ago)
  - 2026-01-03T12:15:00Z (30 min ago)
  - ...
  ↓
Temporal: OffsetRestoreWorkflow
  ├── Stop consumer group (via Bifrost: reject JoinGroup temporarily)
  ├── Reset offsets to checkpoint values
  └── Re-enable consumer group
  ↓
Consumer resumes from checkpoint position
```

---

## 12. UI Structure

### Platform Admin UI (`/platform/kafka`)

```
/platform/kafka/
├── overview                    # Dashboard: cluster health, total apps, usage
├── providers/                  # Kafka provider management (existing)
├── clusters/                   # Physical cluster management (existing)
├── environment-mappings/       # Environment → cluster routing (existing)
├── policies/                   # System-wide topic policies
├── quotas/                     # Default quotas, workspace overrides
├── applications/               # All applications across workspaces (admin view)
│   └── {appId}/               # Application detail (admin perspective)
├── pending-approvals/          # Quota exception requests awaiting platform approval
└── chargeback/                 # System-wide usage reports, exports
```

### Workspace UI (`/{workspace}/kafka`)

```
/{workspace}/kafka/
├── overview                    # Workspace Kafka dashboard
│   ├── Application count vs quota
│   ├── Total usage (bytes in/out)
│   └── Quick links to applications
│
├── applications/
│   ├── (list)                  # All applications in workspace
│   ├── new/                    # Create new application
│   └── {appSlug}/
│       ├── overview            # 3 virtual clusters, health status
│       ├── virtual-clusters/
│       │   └── {env}/          # dev | stage | prod
│       │       ├── topics/
│       │       ├── schemas/
│       │       ├── consumer-groups/
│       │       └── service-accounts/
│       ├── usage/              # Application-level metrics, cost
│       ├── lineage/            # Data flow visualization
│       └── settings/           # Rename, decommission, force delete (admin)
│
└── shared/
    ├── incoming/               # Topics shared with this workspace
    └── outgoing/               # This workspace's topics shared with others
```

### Workspace Home Integration

```
/{workspace}/
├── ...existing sections...
└── Kafka Applications (card)
    ├── "3 of 5 applications"
    ├── Mini usage chart
    └── [View All] → /{workspace}/kafka/applications
```

### Topic Catalog (cross-workspace discovery)

```
/{workspace}/kafka/catalog/
├── Search & filter
│   ├── Filter by: workspace, visibility, schema type
│   └── Search by: topic name, description, tags
├── Topic cards
│   ├── Topic name, owning application
│   ├── Schema type (Avro/Protobuf/JSON/None)
│   ├── Visibility badge (workspace/discoverable/public)
│   └── [Request Access] button
└── My Requests
    └── Pending access requests and their status
```

---

## 13. New Payload Collections

### New Collections Required

| Collection | Purpose | Scope |
|------------|---------|-------|
| `KafkaApplications` | Application definitions | Workspace |
| `KafkaVirtualClusters` | Virtual cluster per app/env | Application |
| `KafkaApplicationQuotas` | Workspace quota overrides | Workspace |
| `KafkaApplicationRequests` | Pending approval requests | Workspace |
| `KafkaOffsetCheckpoints` | Consumer offset snapshots | Virtual Cluster |

### Existing Collections (extended)

| Collection | Changes |
|------------|---------|
| `KafkaTopics` | Add `application`, `virtualCluster`, `createdVia` fields |
| `KafkaServiceAccounts` | Add `application`, `virtualCluster`, `permissionTemplate` fields |
| `KafkaSchemas` | Add `application`, `virtualCluster` fields |
| `KafkaConsumerGroups` | Add `application`, `virtualCluster`, `lagPerPartition` fields |
| `KafkaUsageMetrics` | Add `application`, `virtualCluster` fields |
| `KafkaTopicPolicies` | Already environment-scoped, no changes |

### Collection Schemas

```typescript
// KafkaApplications
{
  id: string
  name: string                    // e.g., "payments-service"
  slug: string                    // e.g., "payments-service"
  workspace: Relationship<Workspace>
  description: string
  status: 'active' | 'decommissioning' | 'deleted'
  decommissioningStartedAt: Date | null
  deletedAt: Date | null
  deletedBy: Relationship<User> | null
  forceDeleted: boolean
  createdBy: Relationship<User>
  createdAt: Date
  updatedAt: Date
}

// KafkaVirtualClusters
{
  id: string
  application: Relationship<KafkaApplication>
  environment: 'dev' | 'stage' | 'prod'
  physicalCluster: Relationship<KafkaCluster>  // via environment mapping
  topicPrefix: string             // e.g., "acme-payments-dev-"
  groupPrefix: string             // e.g., "acme-payments-dev-"
  advertisedHost: string          // e.g., "payments-service.dev.kafka.orbit.io"
  status: 'provisioning' | 'active' | 'read_only' | 'deleting'
  createdAt: Date
  updatedAt: Date
}

// KafkaApplicationQuotas
{
  id: string
  workspace: Relationship<Workspace>
  applicationQuota: number        // overrides system default
  setBy: Relationship<User>
  reason: string                  // why override was granted
  createdAt: Date
  updatedAt: Date
}

// KafkaApplicationRequests
{
  id: string
  workspace: Relationship<Workspace>
  requestedBy: Relationship<User>
  applicationName: string
  description: string
  status: 'pending_workspace' | 'pending_platform' | 'approved' | 'rejected'
  workspaceApprovedBy: Relationship<User> | null
  workspaceApprovedAt: Date | null
  platformApprovedBy: Relationship<User> | null
  platformApprovedAt: Date | null
  platformAction: 'approved_single' | 'increased_quota' | null
  rejectedBy: Relationship<User> | null
  rejectedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}

// KafkaOffsetCheckpoints
{
  id: string
  consumerGroup: Relationship<KafkaConsumerGroup>
  virtualCluster: Relationship<KafkaVirtualCluster>
  checkpointedAt: Date
  offsets: Record<string, number>  // partition → offset
  createdAt: Date
}
```

---

## 14. Proto Definitions

### New Proto File: `proto/idp/gateway/v1/gateway.proto`

```protobuf
syntax = "proto3";

package idp.gateway.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1;gatewayv1";

import "google/protobuf/timestamp.proto";

// ============================================================================
// Bifrost Admin Service (Control Plane → Gateway)
// ============================================================================

service BifrostAdminService {
  // Virtual Cluster lifecycle
  rpc UpsertVirtualCluster(UpsertVirtualClusterRequest) returns (UpsertVirtualClusterResponse);
  rpc DeleteVirtualCluster(DeleteVirtualClusterRequest) returns (DeleteVirtualClusterResponse);
  rpc SetVirtualClusterReadOnly(SetVirtualClusterReadOnlyRequest) returns (SetVirtualClusterReadOnlyResponse);

  // Credential management
  rpc UpsertCredential(UpsertCredentialRequest) returns (UpsertCredentialResponse);
  rpc RevokeCredential(RevokeCredentialRequest) returns (RevokeCredentialResponse);

  // Policy sync
  rpc UpsertPolicy(UpsertPolicyRequest) returns (UpsertPolicyResponse);
  rpc DeletePolicy(DeletePolicyRequest) returns (DeletePolicyResponse);

  // Topic ACLs (for cross-application sharing)
  rpc UpdateTopicACL(UpdateTopicACLRequest) returns (UpdateTopicACLResponse);
  rpc RevokeTopicACL(RevokeTopicACLRequest) returns (RevokeTopicACLResponse);

  // Full sync (startup reconciliation)
  rpc GetFullConfig(GetFullConfigRequest) returns (GetFullConfigResponse);

  // Health & observability
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
  rpc ListVirtualClusters(ListVirtualClustersRequest) returns (ListVirtualClustersResponse);
}

// ============================================================================
// Bifrost Callback Service (Gateway → Control Plane)
// ============================================================================

service BifrostCallbackService {
  // Topic sync (passthrough creates)
  rpc TopicCreated(TopicCreatedRequest) returns (TopicCreatedResponse);
  rpc TopicDeleted(TopicDeletedRequest) returns (TopicDeletedResponse);
  rpc TopicConfigUpdated(TopicConfigUpdatedRequest) returns (TopicConfigUpdatedResponse);

  // Consumer group activity
  rpc ConsumerGroupActivity(ConsumerGroupActivityRequest) returns (ConsumerGroupActivityResponse);

  // Metrics emission
  rpc EmitUsageMetrics(EmitUsageMetricsRequest) returns (EmitUsageMetricsResponse);
}

// ============================================================================
// Messages: Virtual Clusters
// ============================================================================

message VirtualClusterConfig {
  string id = 1;
  string application_id = 2;
  string environment = 3;
  string topic_prefix = 4;
  string group_prefix = 5;
  string transaction_id_prefix = 6;
  string advertised_host = 7;
  int32 advertised_port = 8;
  string physical_bootstrap_servers = 9;
  bool read_only = 10;
}

message UpsertVirtualClusterRequest {
  VirtualClusterConfig config = 1;
}

message UpsertVirtualClusterResponse {}

message DeleteVirtualClusterRequest {
  string virtual_cluster_id = 1;
}

message DeleteVirtualClusterResponse {}

message SetVirtualClusterReadOnlyRequest {
  string virtual_cluster_id = 1;
  bool read_only = 2;
}

message SetVirtualClusterReadOnlyResponse {}

// ============================================================================
// Messages: Credentials
// ============================================================================

message CredentialConfig {
  string id = 1;
  string virtual_cluster_id = 2;
  string username = 3;
  string password_hash = 4;
  PermissionTemplate template = 5;
  repeated CustomPermission custom_permissions = 6;
}

enum PermissionTemplate {
  PERMISSION_TEMPLATE_UNSPECIFIED = 0;
  PERMISSION_TEMPLATE_PRODUCER = 1;
  PERMISSION_TEMPLATE_CONSUMER = 2;
  PERMISSION_TEMPLATE_ADMIN = 3;
  PERMISSION_TEMPLATE_CUSTOM = 4;
}

message CustomPermission {
  string resource_type = 1;  // topic, group, transactional_id
  string resource_pattern = 2;  // regex or literal
  repeated string operations = 3;  // read, write, create, delete, alter
}

message UpsertCredentialRequest {
  CredentialConfig config = 1;
}

message UpsertCredentialResponse {}

message RevokeCredentialRequest {
  string credential_id = 1;
}

message RevokeCredentialResponse {}

// ============================================================================
// Messages: Policies
// ============================================================================

message PolicyConfig {
  string id = 1;
  string environment = 2;
  int32 max_partitions = 3;
  int32 min_partitions = 4;
  int64 max_retention_ms = 5;
  int32 min_replication_factor = 6;
  repeated string allowed_cleanup_policies = 7;
  string naming_pattern = 8;
}

message UpsertPolicyRequest {
  PolicyConfig config = 1;
}

message UpsertPolicyResponse {}

message DeletePolicyRequest {
  string policy_id = 1;
}

message DeletePolicyResponse {}

// ============================================================================
// Messages: Topic ACLs (Sharing)
// ============================================================================

message TopicACLEntry {
  string topic_physical_name = 1;
  string credential_id = 2;
  repeated string permissions = 3;  // read, write
}

message UpdateTopicACLRequest {
  TopicACLEntry entry = 1;
}

message UpdateTopicACLResponse {}

message RevokeTopicACLRequest {
  string topic_physical_name = 1;
  string credential_id = 2;
}

message RevokeTopicACLResponse {}

// ============================================================================
// Messages: Full Config Sync
// ============================================================================

message GetFullConfigRequest {}

message GetFullConfigResponse {
  repeated VirtualClusterConfig virtual_clusters = 1;
  repeated CredentialConfig credentials = 2;
  repeated PolicyConfig policies = 3;
  repeated TopicACLEntry topic_acls = 4;
}

// ============================================================================
// Messages: Status
// ============================================================================

message GetStatusRequest {}

message GetStatusResponse {
  string status = 1;  // healthy, degraded, unhealthy
  int32 active_connections = 2;
  int32 virtual_cluster_count = 3;
  map<string, string> version_info = 4;
}

message ListVirtualClustersRequest {}

message ListVirtualClustersResponse {
  repeated VirtualClusterConfig virtual_clusters = 1;
}

// ============================================================================
// Messages: Callbacks (Gateway → Orbit)
// ============================================================================

message TopicCreatedRequest {
  string virtual_cluster_id = 1;
  string virtual_name = 2;
  string physical_name = 3;
  int32 partitions = 4;
  int32 replication_factor = 5;
  map<string, string> config = 6;
  string created_by_credential_id = 7;
}

message TopicCreatedResponse {}

message TopicDeletedRequest {
  string virtual_cluster_id = 1;
  string virtual_name = 2;
  string physical_name = 3;
  string deleted_by_credential_id = 4;
}

message TopicDeletedResponse {}

message TopicConfigUpdatedRequest {
  string virtual_cluster_id = 1;
  string virtual_name = 2;
  map<string, string> config = 3;
  string updated_by_credential_id = 4;
}

message TopicConfigUpdatedResponse {}

message ConsumerGroupActivityRequest {
  string virtual_cluster_id = 1;
  string virtual_group_id = 2;
  string physical_group_id = 3;
  repeated string subscribed_topics = 4;
  int32 member_count = 5;
  string state = 6;
}

message ConsumerGroupActivityResponse {}

message EmitUsageMetricsRequest {
  string virtual_cluster_id = 1;
  repeated TopicMetrics topic_metrics = 2;
  google.protobuf.Timestamp window_start = 3;
  google.protobuf.Timestamp window_end = 4;
}

message TopicMetrics {
  string topic_virtual_name = 1;
  int64 bytes_in = 2;
  int64 bytes_out = 3;
  int64 message_count_in = 4;
  int64 message_count_out = 5;
}

message EmitUsageMetricsResponse {}
```

---

## 15. Implementation Roadmap

### Phase 1: Foundation (MVP)

Goal: Basic gateway with virtualization, no filters.

| Task | Description |
|------|-------------|
| 1.1 | Set up `gateway/bifrost/` with Kotlin + Gradle + Kroxylicious |
| 1.2 | Implement basic Kafka protocol proxy (passthrough) |
| 1.3 | Implement MetadataResponse rewriting (advertised listeners) |
| 1.4 | Implement SNI-based virtual cluster routing |
| 1.5 | Create `proto/idp/gateway/v1/gateway.proto` |
| 1.6 | Implement BifrostAdminService gRPC server |
| 1.7 | Implement startup config sync (GetFullConfig) |
| 1.8 | Create `KafkaApplications` collection in Payload |
| 1.9 | Create `KafkaVirtualClusters` collection in Payload |
| 1.10 | Build Application creation UI (`/{workspace}/kafka/applications/new`) |
| 1.11 | Implement VirtualClusterProvisionWorkflow (Temporal) |
| 1.12 | Deploy Bifrost-Dev alongside existing infrastructure |
| 1.13 | End-to-end test: create app → connect client → produce/consume |

### Phase 2: Multi-Tenancy & Authentication

Goal: Full tenant isolation with SASL/PLAIN auth.

| Task | Description |
|------|-------------|
| 2.1 | Implement topic name rewriting filter (prefix injection) |
| 2.2 | Implement group.id rewriting filter |
| 2.3 | Implement transactional.id rewriting filter |
| 2.4 | Implement SASL/PLAIN authentication termination |
| 2.5 | Implement credential store with hot-reload |
| 2.6 | Create service account UI (create, rotate, revoke) |
| 2.7 | Implement CredentialUpsertWorkflow, CredentialRevokeWorkflow |
| 2.8 | Implement permission templates (producer, consumer, admin) |
| 2.9 | End-to-end test: tenant isolation, auth rejection |

### Phase 3: Governance & Policies

Goal: Policy-gated self-service topic management.

| Task | Description |
|------|-------------|
| 3.1 | Implement policy enforcement filter |
| 3.2 | Implement CreateTopics passthrough with validation |
| 3.3 | Implement BifrostCallbackService (TopicCreated, etc.) |
| 3.4 | Implement TopicCreatedSyncWorkflow |
| 3.5 | Extend `KafkaTopics` collection with application/virtualCluster |
| 3.6 | Build topics UI within virtual cluster view |
| 3.7 | Implement topic deletion flow with sync |
| 3.8 | End-to-end test: policy compliance, policy violation rejection |

### Phase 4: Quotas & Approvals

Goal: Application quotas with approval workflows.

| Task | Description |
|------|-------------|
| 4.1 | Create `KafkaApplicationQuotas` collection |
| 4.2 | Create `KafkaApplicationRequests` collection |
| 4.3 | Implement quota checking on application creation |
| 4.4 | Build approval request UI (workspace member) |
| 4.5 | Build approval management UI (workspace admin) |
| 4.6 | Build platform approval UI (`/platform/kafka/pending-approvals`) |
| 4.7 | Implement quota override flow |
| 4.8 | End-to-end test: quota exceeded → approval → creation |

### Phase 5: Topic Sharing & Discovery

Goal: Cross-application topic sharing with catalog.

| Task | Description |
|------|-------------|
| 5.1 | Add visibility field to `KafkaTopics` |
| 5.2 | Implement topic catalog UI (`/{workspace}/kafka/catalog`) |
| 5.3 | Implement access request flow |
| 5.4 | Implement TopicShareApprovedWorkflow (ACL updates) |
| 5.5 | Implement UpdateTopicACL in Bifrost |
| 5.6 | Build shared topics UI (incoming/outgoing) |
| 5.7 | End-to-end test: discover → request → approve → consume |

### Phase 6: Metrics & Chargeback

Goal: Usage tracking with cost visibility.

| Task | Description |
|------|-------------|
| 6.1 | Implement metrics emission in Bifrost filters |
| 6.2 | Set up Prometheus scraping for Bifrost |
| 6.3 | Implement UsageMetricsRollupWorkflow |
| 6.4 | Extend `KafkaUsageMetrics` with application/virtualCluster |
| 6.5 | Build usage dashboard (application level) |
| 6.6 | Implement chargeback calculation |
| 6.7 | Build chargeback export (CSV) |
| 6.8 | Build platform chargeback dashboard |

### Phase 7: Schema Registry & Consumer Groups

Goal: Schema visibility and consumer group tracking.

| Task | Description |
|------|-------------|
| 7.1 | Implement Schema Registry subject rewriting in Bifrost |
| 7.2 | Implement SchemaSyncWorkflow |
| 7.3 | Build schemas UI within virtual cluster view |
| 7.4 | Implement consumer group tracking (JoinGroup interception) |
| 7.5 | Implement ConsumerGroupSyncWorkflow |
| 7.6 | Implement ConsumerLagCheckWorkflow |
| 7.7 | Build consumer groups UI with lag display |

### Phase 8: Lineage & Observability

Goal: Data flow visualization.

| Task | Description |
|------|-------------|
| 8.1 | Implement client activity tracking in Bifrost |
| 8.2 | Extend `KafkaClientActivity` collection |
| 8.3 | Build lineage aggregation queries |
| 8.4 | Build lineage visualization UI (per topic, per application) |

### Phase 9: Lifecycle & DR

Goal: Application lifecycle and disaster recovery.

| Task | Description |
|------|-------------|
| 9.1 | Implement decommissioning flow (read-only mode) |
| 9.2 | Implement ApplicationCleanupWorkflow |
| 9.3 | Implement force delete for admins |
| 9.4 | Implement cancellation during grace period |
| 9.5 | Create `KafkaOffsetCheckpoints` collection |
| 9.6 | Implement OffsetCheckpointWorkflow |
| 9.7 | Implement OffsetRestoreWorkflow |
| 9.8 | Build offset recovery UI |

### Phase 10: Production Hardening

Goal: Production readiness.

| Task | Description |
|------|-------------|
| 10.1 | Deploy Bifrost-Stage and Bifrost-Prod |
| 10.2 | Implement connection draining (graceful shutdown) |
| 10.3 | Load testing and performance tuning |
| 10.4 | Chaos testing (network latency, broker failures) |
| 10.5 | Security audit |
| 10.6 | Documentation and runbooks |

---

## Key Decisions Summary

| Area | Decision |
|------|----------|
| **Tenant Model** | Workspace → Application → Virtual Cluster (per env) |
| **Quotas** | System default (5), workspace override, dual-approval when exceeded |
| **Cluster Mapping** | Automatic via KafkaEnvironmentMappings |
| **Service Accounts** | Multiple per Virtual Cluster with permission templates |
| **Topic Creation** | Policy-gated self-service, approval for violations |
| **Topic Sharing** | Tiered visibility (private/workspace/discoverable/public) |
| **Metrics** | Chargeback model with cost-per-byte, no alerts for MVP |
| **Auth** | SASL/PLAIN over TLS (OAUTHBEARER, SCRAM future) |
| **Gateway Entry** | SNI routing, separate Gateway cluster per environment |
| **Control Plane Sync** | Temporal workflows (hybrid batching) |
| **Repo Location** | `gateway/bifrost/` in monorepo |
| **Admin API** | gRPC only |
| **Topic Provisioning** | Hybrid: Gateway passthrough + Temporal sync to Orbit |
| **Schema Registry** | Per-environment, Schema Registry as source of truth |
| **Consumer Groups** | Passive tracking via Gateway → Temporal → Orbit |
| **Lineage** | Activity-based (volume + connections) |
| **UI** | Workspace home cards + dedicated `/{workspace}/kafka/` section |
| **App Lifecycle** | Soft delete with grace period, admin force delete option |
| **DR** | Metadata backup + offset checkpointing |
