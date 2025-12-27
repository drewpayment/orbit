# Kafka Service Capabilities

This document describes the capabilities of the Orbit Kafka service for topic management and cross-workspace sharing.

## Overview

The Kafka service provides a centralized management layer for Apache Kafka topics across the Orbit platform. It enables workspaces to create topics, manage schemas, and share data streams with other workspaces through a governed approval workflow.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend UI   │────▶│  Server Actions │────▶│   gRPC Service  │
│   (Next.js)     │     │  (Next.js API)  │     │   (Go)          │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┼────────────────────────────────┐
                        │                                ▼                                │
                        │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
                        │  │ Temporal Worker │    │  Kafka Adapter  │    │   Payload   │ │
                        │  │ (Async Ops)     │    │  (Multi-Cloud)  │    │   CMS       │ │
                        │  └─────────────────┘    └─────────────────┘    └─────────────┘ │
                        └────────────────────────────────────────────────────────────────┘
```

## Core Capabilities

### 1. Topic Management

**Create Topics**
- Define topic name, partitions, replication factor
- Configure retention period and cleanup policies
- Set compression type (gzip, snappy, lz4, zstd)
- Assign to specific environments (development, staging, production)

**Topic Configuration**
- `min.insync.replicas` for durability guarantees
- Retention time in milliseconds
- Cleanup policy (delete, compact, delete+compact)
- Compression settings per topic

**Topic Lifecycle**
- Pending → Approved workflow for governed environments
- Delete with confirmation
- Update configuration post-creation

### 2. Schema Management

**Supported Formats**
- Avro (recommended for production)
- JSON Schema
- Protobuf

**Schema Registry Integration**
- Register key and value schemas per topic
- Automatic subject naming (`{topic}-key`, `{topic}-value`)
- Version tracking with semantic versioning

**Compatibility Modes**
- `BACKWARD` - New schema can read old data
- `FORWARD` - Old schema can read new data
- `FULL` - Both backward and forward compatible
- `NONE` - No compatibility checking

**Compatibility Checking**
- Pre-registration compatibility validation
- Breaking change detection
- Detailed incompatibility reporting

### 3. Cross-Workspace Sharing

**Access Request Workflow**
1. Consumer workspace discovers available topics
2. Submits access request with justification
3. Owner workspace reviews and approves/rejects
4. Approved consumers receive credentials

**Permission Levels**
- `READ` - Consume messages only
- `WRITE` - Produce messages only
- `READ_WRITE` - Both consume and produce
- `ADMIN` - Full topic management

**Governance Features**
- Audit trail for all access grants
- Expiration dates for temporary access
- Bulk revocation capability
- Share status tracking (pending, approved, rejected, revoked)

### 4. Service Account Management

**Credential Lifecycle**
- Generate service accounts per workspace/topic
- Role-based access (producer, consumer, admin)
- Automatic credential rotation support
- Revocation with immediate effect

**Security**
- Separate credentials per consuming service
- No credential sharing between workspaces
- Audit logging for all operations

### 5. Topic Discovery

**Catalog Features**
- Browse topics across the platform
- Filter by environment, owner, tags
- Search by topic name or description
- View topic metadata before requesting access

**Metadata Exposed**
- Topic name and description
- Owner workspace
- Environment (dev/staging/prod)
- Schema format and compatibility mode
- Partition count and replication factor

### 6. Metrics & Monitoring

**Topic Metrics**
- Messages in/out per period
- Bytes transferred
- Storage utilization
- Consumer lag tracking

**Lineage Tracking**
- Producer services per topic
- Consumer services per topic
- Bytes transferred by service
- Cross-workspace data flow visualization

### 7. Multi-Cloud Provider Support

**Supported Providers**
- Apache Kafka (self-hosted)
- Confluent Cloud
- Amazon MSK
- Azure Event Hubs
- Redpanda
- WarpStream

**Provider Abstraction**
- Unified API across all providers
- Provider-specific configuration mapping
- Capability detection per provider
- Connection validation

### 8. Environment Routing

**Cluster Mapping**
- Map environments to Kafka clusters
- Priority-based routing rules
- Default cluster configuration
- Override rules for specific workspaces

## API Reference

### gRPC Service Methods

| Method | Description |
|--------|-------------|
| `CreateTopic` | Create a new Kafka topic |
| `ListTopics` | List topics with filtering |
| `GetTopic` | Get topic details by ID |
| `UpdateTopic` | Update topic configuration |
| `DeleteTopic` | Delete a topic |
| `ApproveTopic` | Approve a pending topic |
| `RegisterSchema` | Register a schema for a topic |
| `ListSchemas` | List schemas for a topic |
| `GetSchema` | Get schema by ID |
| `CheckSchemaCompatibility` | Check if schema is compatible |
| `RequestTopicAccess` | Request access to a topic |
| `ApproveTopicAccess` | Approve an access request |
| `RevokeTopicAccess` | Revoke topic access |
| `ListTopicShares` | List shares for a topic |
| `DiscoverTopics` | Discover available topics |
| `GetTopicMetrics` | Get topic metrics |
| `GetTopicLineage` | Get producer/consumer lineage |
| `CreateServiceAccount` | Create service account |
| `ListServiceAccounts` | List service accounts |
| `RevokeServiceAccount` | Revoke service account |
| `ListProviders` | List available providers |
| `RegisterCluster` | Register a Kafka cluster |
| `ListClusters` | List registered clusters |
| `ValidateCluster` | Validate cluster connection |
| `DeleteCluster` | Delete a cluster |
| `CreateEnvironmentMapping` | Create environment routing |
| `ListEnvironmentMappings` | List environment mappings |

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/kafka/topics` | GET, POST | List/create topics |
| `/api/kafka/topics/[id]` | GET, PUT, DELETE | Topic operations |
| `/api/kafka/topics/[id]/approve` | POST | Approve topic |
| `/api/kafka/topics/[id]/metrics` | GET | Get metrics |
| `/api/kafka/topics/[id]/lineage` | GET | Get lineage |
| `/api/kafka/schemas` | GET, POST | List/create schemas |
| `/api/kafka/schemas/[id]` | GET | Get schema |
| `/api/kafka/schemas/compatibility` | POST | Check compatibility |
| `/api/kafka/shares` | GET, POST | List/request shares |
| `/api/kafka/shares/[id]/approve` | POST | Approve share |
| `/api/kafka/shares/[id]/revoke` | POST | Revoke share |
| `/api/kafka/discover` | GET | Discover topics |
| `/api/kafka/service-accounts` | GET, POST | Manage accounts |
| `/api/kafka/admin/providers` | GET | List providers |
| `/api/kafka/admin/clusters` | GET, POST | Manage clusters |

## Frontend Features

### Topic List View
- Tabbed interface (My Topics / Discover)
- Status badges (pending, approved, active)
- Quick actions (view, share, delete)
- Environment filtering
- Search functionality

### Topic Detail View
- Overview with configuration display
- Schema viewer with syntax highlighting
- Metrics dashboard with charts
- Lineage visualization
- Sharing management panel

### Create Topic Dialog
- Form validation with real-time feedback
- Environment selection
- Advanced configuration options
- Partition and replication settings

## Testing

### Contract Tests
Located in `services/kafka/tests/contract/`:
- `topic_test.go` - Topic CRUD operations
- `schema_test.go` - Schema management
- `share_test.go` - Access control workflows
- `cluster_test.go` - Provider and cluster management

Run tests:
```bash
cd services/kafka
go test -v ./tests/contract/...
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KAFKA_SERVICE_ADDR` | gRPC service address | `localhost:50055` |
| `TEMPORAL_HOST` | Temporal server host | `localhost:7233` |
| `DATABASE_URL` | PostgreSQL connection | - |
| `REDIS_URL` | Redis connection | `localhost:6379` |

## Future Enhancements

- [ ] Consumer group management
- [ ] Dead letter queue handling
- [ ] Topic mirroring configuration
- [ ] Quota management per workspace
- [ ] Schema evolution visualization
- [ ] Real-time metrics streaming
- [ ] Alerting and notifications
