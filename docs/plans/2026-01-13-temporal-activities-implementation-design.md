# Temporal Activities Implementation Design

**Status:** APPROVED
**Date:** 2026-01-13
**Scope:** Topic Provisioning Path (VirtualClusterActivities, KafkaActivities, TopicSyncActivities)

## 1. Overview

Implement the stubbed Temporal activities to enable end-to-end topic provisioning from the UI to actual Kafka clusters. This covers the "Topic Provisioning Path" - the primary flow for users creating topics.

### Data Flow

```
User creates topic in UI
         │
         ▼
┌─────────────────────────────────┐
│  VirtualClusterActivities       │
│  • GetEnvironmentMapping        │  ← Looks up which cluster/prefix for environment
│  • CreateVirtualCluster         │  ← Creates VC record in Payload
│  • PushToBifrost               │  ← Syncs VC config to gateway via gRPC
│  • UpdateVirtualClusterStatus   │  ← Updates status in Payload
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  KafkaActivities                │
│  • ProvisionTopic              │  ← Creates physical topic on Kafka cluster
│  • UpdateTopicStatus           │  ← Updates topic status in Payload
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  TopicSyncActivities            │
│  • CreateTopicRecord           │  ← Creates/updates topic in Payload
│  • UpdateTopicConfig           │  ← Syncs config changes
└─────────────────────────────────┘
```

## 2. Shared Infrastructure

### 2.1 PayloadClient

Generic HTTP client for Payload CMS REST API.

**Location:** `temporal-workflows/internal/clients/payload_client.go`

```go
type PayloadClient struct {
    baseURL    string
    apiKey     string
    httpClient *http.Client
    logger     *slog.Logger
}

// Core methods:
func NewPayloadClient(baseURL, apiKey string, logger *slog.Logger) *PayloadClient
func (c *PayloadClient) Get(ctx context.Context, collection string, id string) (map[string]any, error)
func (c *PayloadClient) Find(ctx context.Context, collection string, query url.Values) ([]map[string]any, error)
func (c *PayloadClient) Create(ctx context.Context, collection string, data map[string]any) (map[string]any, error)
func (c *PayloadClient) Update(ctx context.Context, collection string, id string, data map[string]any) error
func (c *PayloadClient) Delete(ctx context.Context, collection string, id string) error
```

**Design decisions:**
- Returns `map[string]any` for flexibility (activities define their own typed structs)
- Uses Payload's query parameter format (`where[field][equals]=value`)
- Adds `X-API-Key` header for authentication
- 30-second timeout per request
- Logs request/response for debugging

### 2.2 BifrostClient

gRPC client wrapper for Bifrost Admin Service.

**Location:** `temporal-workflows/internal/clients/bifrost_client.go`

```go
type BifrostClient struct {
    conn   *grpc.ClientConn
    client gatewayv1.BifrostAdminServiceClient
    logger *slog.Logger
}

func NewBifrostClient(address string, logger *slog.Logger) (*BifrostClient, error)
func (c *BifrostClient) Close() error

// Virtual Cluster operations:
func (c *BifrostClient) UpsertVirtualCluster(ctx context.Context, config *gatewayv1.VirtualClusterConfig) error
func (c *BifrostClient) DeleteVirtualCluster(ctx context.Context, id string) error
func (c *BifrostClient) SetVirtualClusterReadOnly(ctx context.Context, id string, readOnly bool) error

// Credential operations (for future use):
func (c *BifrostClient) UpsertCredential(ctx context.Context, cred *gatewayv1.Credential) error
func (c *BifrostClient) RevokeCredential(ctx context.Context, id string) error
```

**Design decisions:**
- Connection established once at worker startup, reused across activities
- Uses existing generated client from `proto/gen/go/idp/gateway/v1/`
- Insecure connection for local dev (configurable for production)

## 3. Activity Implementations

### 3.1 VirtualClusterActivities

**File:** `temporal-workflows/internal/activities/virtual_cluster_activities.go`

**Dependencies:**
- `PayloadClient` for CMS operations
- `BifrostClient` for gateway sync

**Methods:**

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `GetEnvironmentMapping` | applicationID, environment | clusterID, topicPrefix | Query kafka-environment-mappings |
| `CreateVirtualCluster` | applicationID, workspaceID, environment | virtualClusterID | Create record in kafka-virtual-clusters |
| `PushToBifrost` | virtualClusterID | - | Call BifrostClient.UpsertVirtualCluster |
| `UpdateVirtualClusterStatus` | virtualClusterID, status | - | Update status field in Payload |

### 3.2 KafkaActivities

**File:** `temporal-workflows/internal/activities/kafka_activities.go`

**Dependencies:**
- `PayloadClient` for status updates
- `apache.Client` for Kafka cluster operations (existing)

**Methods (MVP):**

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `ProvisionTopic` | clusterID, topicName, partitions, replication | - | Create topic on Kafka cluster |
| `UpdateTopicStatus` | topicID, status, errorMessage | - | Update topic status in Payload |

### 3.3 TopicSyncActivities

**File:** `temporal-workflows/internal/activities/topic_sync_activities.go`

**Dependencies:**
- `PayloadClient` for CMS operations

**Methods:**

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `CreateTopicRecord` | topic metadata | topicID | Create/find topic in kafka-topics |
| `UpdateTopicConfig` | topicID, config changes | - | Update topic config in Payload |

## 4. Worker Integration

**File:** `temporal-workflows/cmd/worker/main.go`

Changes needed:
1. Initialize `PayloadClient` with `ORBIT_API_URL` and `ORBIT_INTERNAL_API_KEY`
2. Initialize `BifrostClient` with `BIFROST_ADMIN_URL`
3. Pass clients to activity constructors
4. Register `KafkaActivities` (not currently registered)

## 5. Configuration

| Environment Variable | Default | Purpose |
|---------------------|---------|---------|
| `ORBIT_API_URL` | `http://localhost:3000` | Payload CMS base URL |
| `ORBIT_INTERNAL_API_KEY` | (required) | API key for Payload auth |
| `BIFROST_ADMIN_URL` | `localhost:50060` | Bifrost admin gRPC address |

## 6. Testing Strategy

**Unit Tests:**
- Mock `PayloadClient` and `BifrostClient` interfaces
- Test each activity method in isolation
- Cover success, error, and edge cases

**Integration Tests:**
- Run against local Docker setup (Payload, Bifrost, Kafka)
- Test full TopicProvisioningWorkflow end-to-end
- Verify topic appears in Kafka cluster

## 7. Implementation Phases

| Phase | Scope | Files |
|-------|-------|-------|
| A | Shared clients | `payload_client.go`, `bifrost_client.go` |
| B | VirtualClusterActivities | `virtual_cluster_activities.go` |
| C | KafkaActivities (MVP) | `kafka_activities.go` |
| D | TopicSyncActivities | `topic_sync_activities.go` |
| E | Worker integration | `main.go` |

## 8. Out of Scope

- Schema registration activities (Phase 2)
- ACL/sharing activities (Phase 2)
- Decommissioning activities (Phase 2)
- Lineage activities (Phase 2)
- Email notifications
